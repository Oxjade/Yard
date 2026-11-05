import { RouteTransition } from "@/components/feedback/route-transition"

export default function StudioTemplate({ children }: { children: React.ReactNode }) {
  return <RouteTransition rise>{children}</RouteTransition>
}
