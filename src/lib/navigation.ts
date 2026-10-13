/* Die fünf Menüpunkte der Seitenleiste (§6.1) und die Reiter der Auswertung (§6.9).
 * Unterseiten liegen unter dem Pfad ihres Menüpunkts und markieren ihn dadurch mit
 * (Beleg-Maske und Vorlagen → /belege/…, Liquidität/Kennzahlen/Steuer → /auswertung/…). */
import {
  ArrowLeftRight,
  BookOpen,
  CalendarDays,
  ChartColumn,
  FileText,
  LayoutDashboard,
  Sigma,
  Users,
  Waves,
  type LucideIcon,
} from 'lucide-react';

export interface NavItem {
  to: string;
  label: string;
  icon: LucideIcon;
}

export const START = '/ein-ausgaenge';

export const NAV: readonly NavItem[] = [
  { to: '/ein-ausgaenge', label: 'Ein- & Ausgänge', icon: ArrowLeftRight },
  { to: '/termine', label: 'Termine', icon: CalendarDays },
  { to: '/belege', label: 'Rechnungen & Quittungen', icon: FileText },
  { to: '/kunden', label: 'Kunden', icon: Users },
  { to: '/auswertung', label: 'Auswertung', icon: ChartColumn },
];

export interface AuswertungTab extends NavItem {
  sub: string;
}

export const AUSWERTUNG: readonly AuswertungTab[] = [
  { to: '/auswertung', label: 'Überblick', icon: LayoutDashboard, sub: 'Wie läuft das Geschäft?' },
  { to: '/auswertung/liquiditaet', label: 'Liquidität', icon: Waves, sub: 'Was in 90 Tagen rein- und rausgeht' },
  { to: '/auswertung/kennzahlen', label: 'Kennzahlen', icon: Sigma, sub: 'Eigene Formeln' },
  { to: '/auswertung/steuer', label: 'Steuer & Export', icon: BookOpen, sub: 'EÜR, Kleinunternehmer, Export' },
];
