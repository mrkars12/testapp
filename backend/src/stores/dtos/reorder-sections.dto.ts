import { IsArray } from 'class-validator'

class SectionOrderItem {
  id: string
  sortOrder: number
}

export class ReorderSectionsDto {
  @IsArray()
  sections: SectionOrderItem[]
}
