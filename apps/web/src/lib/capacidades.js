// Capacidades de Hermes (skills, MCP, web, terminal…) con su icono y búsqueda por categoría.
import { Wand2, Plug, Globe, AppWindow, SquareTerminal, CodeXml, FileText, Brain, Shapes, Users } from 'lucide-react';

// Capacidades de Hermes alrededor del nodo central. Las claves son las mismas
// categorías que envía el servidor (apps/server/src/services/toolActivity.ts).
export const CAPABILITIES = [
  { key: 'skills', label: 'Skills', Icon: Wand2 },
  { key: 'mcp', label: 'MCP', Icon: Plug },
  { key: 'web', label: 'Web', Icon: Globe },
  { key: 'browser', label: 'Navegador', Icon: AppWindow },
  { key: 'terminal', label: 'Terminal', Icon: SquareTerminal },
  { key: 'code', label: 'Código', Icon: CodeXml },
  { key: 'files', label: 'Archivos', Icon: FileText },
  { key: 'memory', label: 'Memoria', Icon: Brain },
  { key: 'other', label: 'Otras', Icon: Shapes },
];

const DELEGATION = { key: 'delegation', label: 'Delegar', Icon: Users };

const BY_KEY = Object.fromEntries([...CAPABILITIES, DELEGATION].map((c) => [c.key, c]));

export function capabilityOf(category) {
  return BY_KEY[category] || BY_KEY.other;
}
