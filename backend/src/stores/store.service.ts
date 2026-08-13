import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';

import { PrismaService } from '../prisma/prisma.service';
import type { store as StoreRecord } from '@prisma/client';
import { CreateSectionDto } from './dtos/create-section.dto';
import { UpdateSectionDto } from './dtos/update-section.dto';
import { ReorderSectionsDto } from './dtos/reorder-sections.dto';
import { UpdateColorsDto } from './dtos/update-colors.dto';
import { UpdateTypographyDto } from './dtos/update-typography.dto';
import { UpdateHeaderDto } from './dtos/update-header.dto';

@Injectable()
export class StoreService {
  constructor(private prisma: PrismaService) {}

  private jsonSafe(data: any) {
    return JSON.parse(
      JSON.stringify(data, (_, value) =>
        typeof value === 'bigint' ? value.toString() : value,
      ),
    );
  }

  async getMyStores(userId: any) {
    return this.prisma.store.findMany({
      where: {
        ownerId: BigInt(userId),
      },
      include: {
        theme: true,
        sections: true,
      },
    });
  }

  async createStore(userId: any, data: any) {
    const now = new Date();
    const store = await this.prisma.store.create({
      data: {
        name: data.name,
        slug: data.slug,
        description: data.description || null,
        currency: data.currency || 'SAR',
        status: 1,
        ownerId: BigInt(userId),
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    });

    // Create default theme for the store
    await this.prisma.guarded().storeTheme.create({
      data: {
        store_id: store.id,
        colors: {
          primary: '#2563eb',
          secondary: '#64748b',
          accent: '#f59e0b',
          background: '#ffffff',
          surface: '#f8fafc',
          textPrimary: '#0f172a',
          textSecondary: '#64748b',
          textMuted: '#94a3b8',
          border: '#e2e8f0',
          headerBg: '#ffffff',
          headerText: '#0f172a',
          footerBg: '#0f172a',
          footerText: '#ffffff',
        },
        typography: {
          headingFont: 'Inter',
          bodyFont: 'Inter',
          baseSize: '16px',
          scale: 1.25,
          h1Size: '2.5rem',
          h2Size: '2rem',
          h3Size: '1.5rem',
          lineHeight: 1.6,
          letterSpacing: 'normal',
        },
        header: {
          showSearch: true,
          showAccount: true,
          showCart: true,
          sticky: false,
          background: '#ffffff',
          textColor: '#0f172a',
          logoPosition: 'left',
          menuPosition: 'center',
        },
        footer: {
          showNewsletter: true,
          showSocialLinks: true,
          columns: 4,
          background: '#0f172a',
          textColor: '#ffffff',
        },
      },
    });

    return store;
  }

  async updateStore(userId: any, slug: string, data: any) {
    const store = await this.prisma.store.findFirst({
      where: {
        slug,
        ownerId: BigInt(userId),
      },
    });

    if (!store) throw new NotFoundException('Store not found');

    return this.prisma.store.update({
      where: {
        id: store.id,
      },
      data: {
        name: data.name,
        description: data.description,
        currency: data.currency,
        status: Number(data.status),
        updatedAt: new Date(),
      },
    });
  }

  // =====================
  // PAGES
  // =====================

  async getStorePages(storeId: bigint) {
    return this.prisma.guarded().storePage.findMany({
      where: {
        store_id: storeId,
      },
      orderBy: {
        sort_order: 'asc',
      },
    });
  }

  /**
   * ⚠️ ملاحظة نوع البيانات: CreateStorePageDto موجود ومستخدم على مستوى
   * الـ Controller، لكن هنا سبناه any عن قصد — حقل type في الـ DTO
   * عبارة عن enum منفصل عن Prisma PageType (نفس القيم النصية، بس TS
   * بيتعامل مع الـ enums بالاسم مش بالشكل)، فتثبيت النوع هنا كان
   * هيكسر الـ build على prisma.storePage.create({ data: { type } }).
   */
  async createStorePage(storeId: bigint, data: any) {
    const lastPage = await this.prisma.guarded().storePage.findFirst({
      where: {
        store_id: storeId,
      },
      orderBy: {
        sort_order: 'desc',
      },
    });

    return this.prisma.guarded().storePage.create({
      data: {
        store_id: storeId,
        title: data.title,
        slug: data.slug,
        type: data.type,
        content: data.content || null,
        sort_order: lastPage ? lastPage.sort_order + 1 : 0,
      },
    });
  }

  async updateStorePage(storeId: bigint, pageId: string, data: any) {
    const page = await this.prisma.guarded().storePage.findFirst({
      where: {
        id: BigInt(pageId),
        store_id: storeId,
      },
    });

    if (!page) throw new NotFoundException('Page not found');

    return this.prisma.guarded().storePage.update({
      where: {
        id: BigInt(pageId),
        store_id: storeId,
      },
      data: {
        title: data.title,
        slug: data.slug,
        type: data.type,
        content: data.content,
        is_active: data.is_active,
        image_url: data.image_url,
      },
    });
  }

  async deleteStorePage(storeId: bigint, pageId: string) {
    const page = await this.prisma.guarded().storePage.findFirst({
      where: {
        id: BigInt(pageId),
        store_id: storeId,
      },
    });

    if (!page) throw new NotFoundException('Page not found');

    return this.prisma.guarded().storePage.delete({
      where: {
        id: BigInt(pageId),
        store_id: storeId,
      },
    });
  }

  async reorderPages(storeId: bigint, pages: any[]) {
    // ✅ تحقق ملكية: كل الصفحات المطلوب ترتيبها لازم تكون بتاعة نفس
    // المتجر الفعّال — قبل كده الميثود دي كانت بتحدّث أي id يتبعت من
    // غير أي تحقق خالص.
    const ids = pages.map((p) => BigInt(p.id));
    const owned = await this.prisma.guarded().storePage.findMany({
      where: {
        id: { in: ids },
        store_id: storeId,
      },
      select: {
        id: true,
      },
    });

    if (owned.length !== ids.length) {
      throw new NotFoundException('One or more pages not found');
    }

    return Promise.all(
      pages.map((page) =>
        this.prisma.guarded().storePage.update({
          where: {
            id: BigInt(page.id),
            store_id: storeId,
          },
          data: {
            sort_order: page.sort_order,
          },
        }),
      ),
    );
  }

  // =====================
  // MENUS
  // =====================

  async getMenus(storeId: bigint) {
    return this.prisma.guarded().storeMenu.findMany({
      where: {
        store_id: storeId,
      },
      include: {
        items: {
          orderBy: {
            sort_order: 'asc',
          },
        },
      },
    });
  }

  async createMenu(storeId: bigint, name: string) {
    const baseHandle = name.toLowerCase().trim().replace(/\s+/g, '-');

    const handle = `${baseHandle}-${Date.now()}`;

    return this.prisma.guarded().storeMenu.create({
      data: {
        name,
        handle,
        store_id: storeId,
      },
    });
  }

  async updateMenu(storeId: bigint, id: string, data: any) {
    // ✅ تحقق ملكية: قبل كده الميثود دي كانت بتحدّث أي menu id يتبعت
    // من غير أي تحقق إن المينيو ده بتاع المتجر الفعّال أصلاً.
    const menu = await this.prisma.guarded().storeMenu.findFirst({
      where: {
        id: BigInt(id),
        store_id: storeId,
      },
    });

    if (!menu) throw new NotFoundException('Menu not found');

    return this.prisma.guarded().storeMenu.update({
      where: {
        id: BigInt(id),
        store_id: storeId,
      },
      data: {
        name: data.name,
      },
    });
  }

  async deleteMenu(storeId: bigint, id: string) {
    const menu = await this.prisma.guarded().storeMenu.findFirst({
      where: {
        id: BigInt(id),
        store_id: storeId,
      },
    });

    if (!menu) throw new NotFoundException('Menu not found');

    return this.prisma.guarded().storeMenu.delete({
      where: {
        id: BigInt(id),
        store_id: storeId,
      },
    });
  }

  async addMenuItem(storeId: bigint, menuId: string, data: any) {
    const menu = await this.prisma.guarded().storeMenu.findFirst({
      where: {
        id: BigInt(menuId),
        store_id: storeId,
      },
    });

    if (!menu) throw new NotFoundException('Menu not found');

    const parentId =
      data.parent_id === undefined ||
      data.parent_id === null ||
      data.parent_id === ''
        ? null
        : BigInt(data.parent_id);

    if (parentId !== null) {
      const parent = await this.prisma.menuItem.findFirst({
        where: {
          id: parentId,
          menu_id: menu.id,
        },
        select: {
          id: true,
          parent_id: true,
        },
      });

      if (!parent) {
        throw new NotFoundException('Parent menu item not found');
      }

      // This menu currently supports one nesting level: parent -> child.
      // Prevent self/cross-level/cyclic parent chains.
      if (parent.parent_id !== null) {
        throw new BadRequestException(
          'A menu item parent must be a root menu item.',
        );
      }
    }

    const lastItem = await this.prisma.menuItem.findFirst({
      where: {
        menu_id: menu.id,
      },
      orderBy: {
        sort_order: 'desc',
      },
    });

    return this.prisma.menuItem.create({
      data: {
        menu_id: menu.id,
        title: data.title,
        type: data.type,
        url: data.url,
        resource_id: data.resource_id || null,
        parent_id: parentId,
        sort_order: lastItem ? lastItem.sort_order + 1 : 0,
      },
    });
  }

  async updateMenuItem(storeId: bigint, itemId: string, data: any) {
    const item = await this.prisma.menuItem.findFirst({
      where: {
        id: BigInt(itemId),
        menu: {
          store_id: storeId,
        },
      },
      select: {
        id: true,
        menu_id: true,
      },
    });

    if (!item) throw new NotFoundException('Menu item not found');

    const parentId =
      data.parent_id === undefined ||
      data.parent_id === null ||
      data.parent_id === ''
        ? null
        : BigInt(data.parent_id);

    if (parentId !== null) {
      if (parentId === item.id) {
        throw new BadRequestException('A menu item cannot be its own parent.');
      }

      const parent = await this.prisma.menuItem.findFirst({
        where: {
          id: parentId,
          menu_id: item.menu_id,
        },
        select: {
          id: true,
          parent_id: true,
        },
      });

      if (!parent) {
        throw new NotFoundException('Parent menu item not found');
      }

      // Preserve the existing one-level menu tree and prevent cycles.
      if (parent.parent_id !== null) {
        throw new BadRequestException(
          'A menu item parent must be a root menu item.',
        );
      }
    }

    return this.prisma.menuItem.update({
      where: {
        id: item.id,
      },
      data: {
        title: data.title,
        url: data.url,
        type: data.type,
        resource_id: data.resource_id || null,
        parent_id: parentId,
      },
    });
  }

  async deleteMenuItem(storeId: bigint, itemId: string) {
    const item = await this.prisma.menuItem.findFirst({
      where: {
        id: BigInt(itemId),
        menu: {
          store_id: storeId,
        },
      },
      select: {
        id: true,
      },
    });

    if (!item) throw new NotFoundException('Menu item not found');

    return this.prisma.menuItem.delete({
      where: {
        id: item.id,
      },
    });
  }

  async reorderMenuItems(storeId: bigint, items: any[]) {
    const ids = items.map((i) => BigInt(i.id));

    const owned = await this.prisma.menuItem.findMany({
      where: {
        id: { in: ids },
        menu: {
          store_id: storeId,
        },
      },
      select: {
        id: true,
        menu_id: true,
      },
    });

    if (owned.length !== ids.length) {
      throw new NotFoundException('One or more menu items not found');
    }

    const ownedById = new Map(owned.map((item) => [item.id.toString(), item]));

    const requestedParentIds = items
      .filter((item) => item.parentId !== undefined && item.parentId !== null)
      .map((item) => BigInt(item.parentId))
      .filter((parentId) => parentId !== 0n);

    if (requestedParentIds.length > 0) {
      const parentIds = [
        ...new Set(requestedParentIds.map((id) => id.toString())),
      ].map((id) => BigInt(id));

      const parents = await this.prisma.menuItem.findMany({
        where: {
          id: { in: parentIds },
          menu: {
            store_id: storeId,
          },
        },
        select: {
          id: true,
          menu_id: true,
          parent_id: true,
        },
      });

      const parentById = new Map(
        parents.map((parent) => [parent.id.toString(), parent]),
      );

      for (const item of items) {
        if (
          item.parentId === undefined ||
          item.parentId === null ||
          item.parentId === ''
        ) {
          continue;
        }

        const itemRecord = ownedById.get(BigInt(item.id).toString());

        if (!itemRecord) {
          throw new NotFoundException('One or more menu items not found');
        }

        const parent = parentById.get(BigInt(item.parentId).toString());

        if (!parent) {
          throw new NotFoundException('Parent menu item not found');
        }

        if (parent.id === itemRecord.id) {
          throw new BadRequestException(
            'A menu item cannot be its own parent.',
          );
        }

        if (parent.menu_id !== itemRecord.menu_id) {
          throw new BadRequestException(
            'A menu item parent must belong to the same menu.',
          );
        }

        // Preserve the existing one-level tree and prevent cycles.
        if (parent.parent_id !== null) {
          throw new BadRequestException(
            'A menu item parent must be a root menu item.',
          );
        }
      }
    }

    return Promise.all(
      items.map((item) =>
        this.prisma.menuItem.update({
          where: {
            id: BigInt(item.id),
          },
          data: {
            sort_order: item.sortOrder,
            ...(item.parentId !== undefined
              ? {
                  parent_id:
                    item.parentId === null || item.parentId === ''
                      ? null
                      : BigInt(item.parentId),
                }
              : {}),
          },
        }),
      ),
    );
  }

  // =====================
  // LINK PICKER
  // =====================

  async getLinkPicker(storeId: bigint) {
    const pages = await this.prisma.guarded().storePage.findMany({
      where: {
        store_id: storeId,
      },
      orderBy: {
        title: 'asc',
      },
    });

    const policies = [
      {
        title: 'Privacy Policy',
        url: '/policies/privacy',
      },
      {
        title: 'Refund Policy',
        url: '/policies/refund',
      },
      {
        title: 'Terms of Service',
        url: '/policies/terms',
      },
    ];

    return {
      pages,
      policies,
      collections: [],
      products: [],
      blogs: [],
      blogPosts: [],
      canCreateCollection: true,
      canCreateProduct: true,
      canCreateBlog: true,
      canCreatePost: true,
    };
  }

  async getMenu(storeId: bigint, menuId: string) {
    return this.prisma.guarded().storeMenu.findFirst({
      where: {
        id: BigInt(menuId),
        store_id: storeId,
      },
      include: {
        items: {
          orderBy: {
            sort_order: 'asc',
          },
        },
      },
    });
  }

  async duplicateMenu(storeId: bigint, menuId: string) {
    const menu = await this.prisma.guarded().storeMenu.findFirst({
      where: {
        id: BigInt(menuId),
        store_id: storeId,
      },
      include: {
        items: {
          orderBy: {
            sort_order: 'asc',
          },
        },
      },
    });

    if (!menu) throw new NotFoundException('Menu not found');

    return this.prisma.guarded().$transaction(async (tx) => {
      const newMenu = await tx.storeMenu.create({
        data: {
          store_id: menu.store_id,
          name: `${menu.name} copy`,
          handle: `${menu.handle}-copy-${Date.now()}`,
        },
      });

      const idMap = new Map<string, bigint>();

      const roots = menu.items.filter((item) => !item.parent_id);
      const children = menu.items.filter((item) => item.parent_id);

      for (const item of roots) {
        const created = await tx.menuItem.create({
          data: {
            menu_id: newMenu.id,
            title: item.title,
            type: item.type,
            url: item.url,
            resource_id: item.resource_id,
            sort_order: item.sort_order,
          },
        });

        idMap.set(item.id.toString(), created.id);
      }

      for (const item of children) {
        const newParentId = idMap.get(item.parent_id!.toString());

        if (!newParentId) {
          throw new BadRequestException(
            'Menu contains an invalid parent relationship.',
          );
        }

        const created = await tx.menuItem.create({
          data: {
            menu_id: newMenu.id,
            title: item.title,
            type: item.type,
            url: item.url,
            resource_id: item.resource_id,
            parent_id: newParentId,
            sort_order: item.sort_order,
          },
        });

        idMap.set(item.id.toString(), created.id);
      }

      return newMenu;
    });
  }

  // =====================
  // THEME SYSTEM
  // =====================

  async getTheme(storeId: bigint) {
    let theme = await this.prisma.guarded().storeTheme.findUnique({
      where: {
        store_id: storeId,
      },
    });

    if (!theme) {
      theme = await this.prisma.guarded().storeTheme.create({
        data: {
          store_id: storeId,
          colors: {
            primary: '#2563eb',
            secondary: '#64748b',
            accent: '#f59e0b',
            background: '#ffffff',
            surface: '#f8fafc',
            textPrimary: '#0f172a',
            textSecondary: '#64748b',
            textMuted: '#94a3b8',
            border: '#e2e8f0',
            headerBg: '#ffffff',
            headerText: '#0f172a',
            footerBg: '#0f172a',
            footerText: '#ffffff',
          },
          typography: {
            headingFont: 'Inter',
            bodyFont: 'Inter',
            baseSize: '16px',
            scale: 1.25,
            h1Size: '2.5rem',
            h2Size: '2rem',
            h3Size: '1.5rem',
            lineHeight: 1.6,
            letterSpacing: 'normal',
          },
          header: {
            showSearch: true,
            showAccount: true,
            showCart: true,
            sticky: false,
            background: '#ffffff',
            textColor: '#0f172a',
            logoPosition: 'left',
            menuPosition: 'center',
          },
          footer: {
            showNewsletter: true,
            showSocialLinks: true,
            columns: 4,
            background: '#0f172a',
            textColor: '#ffffff',
          },
        },
      });
    }

    // Fetch sections separately
    const sections = await this.prisma.guarded().themeSection.findMany({
      where: {
        store_id: storeId,
      },
      orderBy: {
        sort_order: 'asc',
      },
    });

    return {
      ...theme,
      sections,
    };
  }

  async updateTheme(storeId: bigint, content: any) {
    const data: any = {
      updated_at: new Date(),
    };

    if (content.colors) data.colors = content.colors;
    if (content.typography) data.typography = content.typography;
    if (content.header) data.header = content.header;
    if (content.footer) data.footer = content.footer;
    if (content.settings) data.settings = content.settings;

    data.menu_id = content.menu_id ? BigInt(content.menu_id) : null;

    return this.prisma.guarded().storeTheme.upsert({
      where: {
        store_id: storeId,
      },
      create: {
        store_id: storeId,
        menu_id: content.menu_id ? BigInt(content.menu_id) : null,
        colors: content.colors || {},
        typography: content.typography || {},
        header: content.header || {},
        footer: content.footer || {},
        settings: content.settings || null,
      },
      update: data,
    });
  }

  private async createPublishedTheme(storeId: bigint) {
    const themeRaw = await this.prisma.guarded().storeTheme.findUnique({
      where: {
        store_id: storeId,
      },
    });

    const sectionsRaw = await this.prisma.guarded().themeSection.findMany({
      where: {
        store_id: storeId,
        is_active: true,
      },
      orderBy: {
        sort_order: 'asc',
      },
    });

    const menusRaw = await this.prisma.guarded().storeMenu.findMany({
      where: {
        store_id: storeId,
      },
      include: {
        items: {
          orderBy: {
            sort_order: 'asc',
          },
        },
      },
    });

    const theme = this.jsonSafe(themeRaw);
    const sections = this.jsonSafe(sectionsRaw);
    const menus = this.jsonSafe(menusRaw);

    await this.prisma.guarded().storeThemePublished.upsert({
      where: {
        store_id: storeId,
      },
      create: {
        store_id: storeId,
        theme,
        sections,
        menus,
      },
      update: {
        theme,
        sections,
        menus,
      },
    });
  }

  async publishTheme(storeId: bigint) {
    await this.createPublishedTheme(storeId);

    return {
      success: true,
    };
  }

  async updateThemeColors(storeId: bigint, colors: UpdateColorsDto) {
    return this.prisma.guarded().storeTheme.update({
      where: {
        store_id: storeId,
      },
      data: {
        colors: { ...colors },
      },
    });
  }

  async updateThemeTypography(
    storeId: bigint,
    typography: UpdateTypographyDto,
  ) {
    return this.prisma.guarded().storeTheme.update({
      where: {
        store_id: storeId,
      },
      data: {
        typography: { ...typography },
      },
    });
  }

  async updateThemeHeader(storeId: bigint, header: UpdateHeaderDto) {
    return this.prisma.guarded().storeTheme.update({
      where: {
        store_id: storeId,
      },
      data: {
        header: { ...header },
      },
    });
  }

  async updateThemeFooter(storeId: bigint, footer: any) {
    return this.prisma.guarded().storeTheme.update({
      where: {
        store_id: storeId,
      },
      data: {
        footer,
      },
    });
  }

  /**
   * ⚠️ استثناء مقصود: الميثود دي (بخلاف باقي الميثودز فوق) بتاخد صف
   * المتجر كامل (store) مش storeId بس — لأن الـ response الأصلي بيرجّع
   * الـ store نفسه جوه الكائن الراجع ({ store, theme, sections, menus })،
   * وعايزين نحافظ على نفس شكل الـ API response زي ما هو بالظبط.
   */
  async getThemePreview(store: StoreRecord) {
    const theme = await this.prisma.guarded().storeTheme.findUnique({
      where: {
        store_id: store.id,
      },
    });

    const sections = await this.prisma.guarded().themeSection.findMany({
      where: {
        store_id: store.id,
      },
      orderBy: {
        sort_order: 'asc',
      },
    });

    const menus = await this.prisma.guarded().storeMenu.findMany({
      where: {
        store_id: store.id,
      },
      include: {
        items: {
          orderBy: {
            sort_order: 'asc',
          },
        },
      },
    });

    return {
      store,
      theme,
      sections,
      menus,
    };
  }

  // async getPublicStoreProducts(slug: string, limit: number = 8) {
  //   const store = await this.prisma.store.findUnique({ where: { slug } })
  //   if (!store) return []

  //   return this.prisma.product.findMany({
  //     where: { store_id: store.id, status: 'active' },
  //     take: limit,
  //     orderBy: { created_at: 'desc' },
  //   })
  // }

  // =====================
  // THEME SECTIONS
  // =====================

  async getThemeSections(storeId: bigint, pageType: string = 'home') {
    return this.prisma.guarded().themeSection.findMany({
      where: {
        store_id: storeId,
        page_type: pageType,
      },
      orderBy: {
        sort_order: 'asc',
      },
    });
  }

  async addThemeSection(storeId: bigint, data: CreateSectionDto) {
    const lastSection = await this.prisma.guarded().themeSection.findFirst({
      where: {
        store_id: storeId,
        page_type: data.pageType || 'home',
      },
      orderBy: {
        sort_order: 'desc',
      },
    });

    return this.prisma.guarded().themeSection.create({
      data: {
        store_id: storeId,
        type: data.type,
        name: data.name,
        settings: data.settings || {},
        blocks: data.blocks || [],
        sort_order: lastSection ? lastSection.sort_order + 1 : 0,
        page_type: data.pageType || 'home',
        is_active: true,
      },
    });
  }

  async updateThemeSection(
    storeId: bigint,
    sectionId: string,
    data: UpdateSectionDto,
  ) {
    const section = await this.prisma.guarded().themeSection.findFirst({
      where: {
        id: BigInt(sectionId),
        store_id: storeId,
      },
    });

    if (!section) throw new NotFoundException('Section not found');

    return this.prisma.guarded().themeSection.update({
      where: {
        id: BigInt(sectionId),
        store_id: storeId,
      },
      data: {
        name: data.name,
        settings: data.settings,
        blocks: data.blocks,
        sort_order: data.sortOrder,
        is_active: data.isActive,
      },
    });
  }

  async deleteThemeSection(storeId: bigint, sectionId: string) {
    const section = await this.prisma.guarded().themeSection.findFirst({
      where: {
        id: BigInt(sectionId),
        store_id: storeId,
      },
    });

    if (!section) throw new NotFoundException();

    return this.prisma.guarded().themeSection.delete({
      where: {
        id: BigInt(sectionId),
        store_id: storeId,
      },
    });
  }

  async reorderThemeSections(
    storeId: bigint,
    sections: ReorderSectionsDto['sections'],
  ) {
    // ✅ تحقق ملكية: نفس فكرة reorderPages/reorderMenuItems.
    const ids = sections.map((s) => BigInt(s.id));
    const owned = await this.prisma.guarded().themeSection.findMany({
      where: {
        id: { in: ids },
        store_id: storeId,
      },
      select: {
        id: true,
      },
    });

    if (owned.length !== ids.length) {
      throw new NotFoundException('One or more sections not found');
    }

    return Promise.all(
      sections.map((section) =>
        this.prisma.guarded().themeSection.update({
          where: {
            id: BigInt(section.id),
            store_id: storeId,
          },
          data: {
            sort_order: section.sortOrder,
          },
        }),
      ),
    );
  }

  // =====================
  // PUBLIC STORE
  // =====================

  async getPublicStore(slug: string) {
    const store = await this.prisma.store.findUnique({
      where: {
        slug,
      },
    });

    if (!store) return null;

    const published = await this.prisma
      .guarded()
      .storeThemePublished.findUnique({
        where: {
          store_id: store.id,
        },
      });

    return {
      ...store,
      theme: published?.theme || null,
      sections: published?.sections || [],
      menus: published?.menus || [],
    };
  }

  // stores.zip/store.service.ts - أضف/تأكد من وجود الدول دي

  async getPublicStoreTheme(slug: string) {
    const store = await this.prisma.store.findUnique({
      where: { slug },
    });

    if (!store) return null;

    const published = await this.prisma
      .guarded()
      .storeThemePublished.findUnique({
        where: {
          store_id: store.id,
        },
      });

    return published?.theme || null;
  }

  async getPublicStoreSections(slug: string, pageType: string = 'home') {
    const store = await this.prisma.store.findUnique({
      where: { slug },
    });

    if (!store) return null;

    return this.prisma.guarded().themeSection.findMany({
      where: {
        store_id: store.id,
        page_type: pageType,
        is_active: true,
      },
      orderBy: {
        sort_order: 'asc',
      },
    });
  }

  async getPublicStorePage(slug: string, pageSlug: string) {
    const store = await this.prisma.store.findUnique({
      where: { slug },
    });

    if (!store) return null;

    return this.prisma.guarded().storePage.findFirst({
      where: {
        store_id: store.id,
        slug: pageSlug,
      },
    });
  }

  async getPublicStoreMenu(slug: string, handle: string) {
    const store = await this.prisma.store.findUnique({
      where: { slug },
    });

    if (!store) return null;

    return this.prisma.guarded().storeMenu.findFirst({
      where: {
        store_id: store.id,
        handle,
      },
      include: {
        items: {
          orderBy: {
            sort_order: 'asc',
          },
        },
      },
    });
  }
}
