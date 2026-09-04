'use client'

import { useParams } from 'next/navigation'
import ProductFormPage from '../../ProductFormPage'

export default function EditProductPage() {
  const params = useParams()
  const productId = params?.id as string

  return <ProductFormPage productId={productId} />
}