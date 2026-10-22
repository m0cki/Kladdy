/* Symbole für Kategorien (Spalte kategorien.icon = lucide-Name, Auswahl in lib/kategorien.ts → KATEGORIE_ICONS) und
 * Zahlungswege (§9.7). Unbekannte Namen zeigen ein neutrales Listen-Symbol. */
import {
  Banknote,
  Box,
  Briefcase,
  Calculator,
  Car,
  CircleDollarSign,
  Ellipsis,
  Fuel,
  Gift,
  Hammer,
  House,
  Landmark,
  Leaf,
  List,
  Megaphone,
  Monitor,
  Shield,
  Smartphone,
  Tag,
  TrendingDown,
  Truck,
  Utensils,
  Wrench,
  type LucideIcon,
  type LucideProps,
} from 'lucide-react';
import type { Zahlungsart } from '../../lib/buchungen';
import { istKategorieIcon, type KategorieIconName } from '../../lib/kategorien';

const KATEGORIE_ICONS: Readonly<Record<KategorieIconName, LucideIcon>> = {
  wrench: Wrench,
  box: Box,
  fuel: Fuel,
  ellipsis: Ellipsis,
  tag: Tag,
  hammer: Hammer,
  leaf: Leaf,
  truck: Truck,
  car: Car,
  smartphone: Smartphone,
  megaphone: Megaphone,
  shield: Shield,
  briefcase: Briefcase,
  monitor: Monitor,
  calculator: Calculator,
  'trending-down': TrendingDown,
  utensils: Utensils,
  gift: Gift,
  house: House,
};

export function KategorieIcon({ icon, ...props }: { icon: string | null } & LucideProps) {
  const Icon = istKategorieIcon(icon) ? KATEGORIE_ICONS[icon] : List;
  return <Icon {...props} />;
}

export const ZAHLUNGSWEG_ICON: Readonly<Record<Zahlungsart, LucideIcon>> = { bar: Banknote, bank: Landmark, paypal: CircleDollarSign };
