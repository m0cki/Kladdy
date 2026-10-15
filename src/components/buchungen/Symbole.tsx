/* Symbole für Kategorien (Spalte kategorien.icon = lucide-Name, Migration 0002) und Zahlungswege (§9.7). */
import { Banknote, Box, CircleDollarSign, Ellipsis, Fuel, Landmark, List, Wrench, type LucideIcon, type LucideProps } from 'lucide-react';
import type { Zahlungsart } from '../../lib/buchungen';

const KATEGORIE_ICONS: Readonly<Record<string, LucideIcon>> = { wrench: Wrench, box: Box, fuel: Fuel, ellipsis: Ellipsis };

export function KategorieIcon({ icon, ...props }: { icon: string | null } & LucideProps) {
  const Icon = (icon && KATEGORIE_ICONS[icon]) || List;
  return <Icon {...props} />;
}

export const ZAHLUNGSWEG_ICON: Readonly<Record<Zahlungsart, LucideIcon>> = { bar: Banknote, bank: Landmark, paypal: CircleDollarSign };
