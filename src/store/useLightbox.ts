import { create } from 'zustand';

interface LightboxState {
  open: boolean;
  index: number;
  show: (index: number) => void;
  close: () => void;
  setIndex: (i: number) => void;
}

export const useLightbox = create<LightboxState>(set => ({
  open: false,
  index: 0,
  show: index => set({ open: true, index }),
  close: () => set({ open: false }),
  setIndex: index => set({ index }),
}));
