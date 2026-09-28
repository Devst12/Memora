import ItemDetail from "@/components/item-detail";

export default async function SavedItemPage({ params }: PageProps<"/items/[id]">) {
  const { id } = await params;
  return <ItemDetail id={id} />;
}
