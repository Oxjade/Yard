import { RouteTransition } from "@/components/feedback/route-transition"

export default function MarketTemplate({ children }: { children: React.ReactNode }) {
  return <RouteTransition>{children}</RouteTransition>
}
