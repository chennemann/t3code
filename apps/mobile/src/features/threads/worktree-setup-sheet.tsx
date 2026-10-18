import type { ReactElement } from "react";
import { AppSheet } from "../../components/AppSheet";

export interface WorktreeSetupSheetProps {
  children: ReactElement;
  title: string;
  height: number;
  onClose: () => void;
}

export function WorktreeSetupSheet({ children, onClose, title }: WorktreeSetupSheetProps) {
  return (
    <AppSheet title={title} onClose={onClose}>
      {children}
    </AppSheet>
  );
}
