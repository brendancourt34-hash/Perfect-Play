import { Lucide } from "@react-native-vector-icons/lucide";
import { colors } from "../constants/theme";

/**
 * Single import point for every icon in the app (Phase 14 design system requirement:
 * a real icon library, never emoji). Screens reference semantic names here rather than
 * raw Lucide glyph names, so swapping the underlying icon set later only touches this file.
 */
const GLYPHS = {
  home: "house",
  entries: "clipboard-list",
  account: "circle-user",
  back: "arrow-left",
  chevronRight: "chevron-right",
  chevronDown: "chevron-down",
  search: "search",
  close: "x",
  check: "check",
  checkCircle: "circle-check",
  xCircle: "circle-x",
  pending: "clock",
  trophy: "trophy",
  logout: "log-out",
  calendar: "calendar-days",
  live: "circle-dot",
  refresh: "refresh-cw",
  dollar: "dollar-sign",
  wallet: "wallet",
  competitions: "list-checks",
  more: "menu",
  bell: "bell",
  ticket: "ticket",
  flag: "flag",
} as const;

export type IconName = keyof typeof GLYPHS;

interface IconProps {
  name: IconName;
  size?: number;
  color?: string;
}

export function Icon({ name, size = 20, color = colors.foreground }: IconProps) {
  return <Lucide name={GLYPHS[name]} size={size} color={color} />;
}
