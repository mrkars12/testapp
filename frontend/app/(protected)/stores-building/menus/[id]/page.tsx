import MenuBuilder from './MenuBuilder'

export default async function Page({
  params
}: {
  params: Promise<{
    id: string
  }>
}) {
  const { id } = await params

  return (
    <MenuBuilder
      menuId={id}
    />
  )
}