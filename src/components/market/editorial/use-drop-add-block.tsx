"use client"

/**
 * Kept for existing importers. The drop rules now live beside the product card
 * (components/market/use-drop-add-block.ts) and every QuickAdd applies them from the product's
 * dropId, so ShopProductCard is simply ProductCard: import that instead.
 */
export { dropOf, useDropAddBlock, type DropAddBlock } from "@/components/market/use-drop-add-block"
export { ProductCard as ShopProductCard } from "@/components/market/product-card"
