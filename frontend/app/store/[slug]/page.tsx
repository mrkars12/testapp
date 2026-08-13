'use client'

import { useStore } from './components/StoreContext'
import {
  HeroSection,
  ProductGridSection,
  FeaturedCollectionSection,
  NewsletterSection,
  RichTextSection,
  TextBannerSection,
  SlideshowSection,
} from './components/Sections'

export default function StoreFrontPage() {
  const { store } = useStore()

  // الـ layout بيتكفل بحالة اللودينج والخطأ، فمفيش داعي نكررها هنا
  if (!store) return null

  return (
    <main>
      {store.sections
        ?.filter((s: any) => s.is_active)
        ?.sort((a: any, b: any) => a.sort_order - b.sort_order)
        ?.map((section: any) => (
          <SectionRenderer key={section.id} section={section} store={store} />
        ))}
    </main>
  )
}

function SectionRenderer({ section }: any) {
  const { type, settings } = section

  switch (type) {
    case 'hero':
      return <HeroSection settings={settings} />
    case 'featured_collection':
      return <FeaturedCollectionSection settings={settings} />
    case 'slideshow':
      return <SlideshowSection settings={settings} />
    case 'product_grid':
      return <ProductGridSection settings={settings} />
    case 'newsletter':
      return <NewsletterSection settings={settings} />
    case 'rich_text':
      return <RichTextSection settings={settings} />
    case 'text_banner':
      return <TextBannerSection settings={settings} />
    default:
      return null
  }
}