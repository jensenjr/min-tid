import { createFileRoute } from "@tanstack/react-router";
import PunchClock from "@/components/PunchClock";

export const Route = createFileRoute("/")({
  component: PunchClock,
  head: () => ({
    meta: [
      { title: "Tidrapport – Dalslands Sparbank" },
      { name: "description", content: "Enkel tidsregistrering för anställda. Stämpla in, stämpla ut, dela rapport." },
      { name: "viewport", content: "width=device-width, initial-scale=1, maximum-scale=1, viewport-fit=cover" },
      { name: "theme-color", content: "#ff5f00" },
      { name: "apple-mobile-web-app-capable", content: "yes" },
      { name: "apple-mobile-web-app-status-bar-style", content: "default" },
      { name: "apple-mobile-web-app-title", content: "Tidrapport" },
    ],
  }),
});
