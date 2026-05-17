import { createFileRoute } from "@tanstack/react-router";
import PunchClock from "@/components/PunchClock";

export const Route = createFileRoute("/")({
  component: PunchClock,
});
