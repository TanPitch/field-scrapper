/* useAnnotations.ts — user-authored labels and notes for table columns,
 * drawings and display areas.
 *
 * Kept out of useApp deliberately: it is a different lifetime. App settings are
 * device/app state, while an annotation is content the user made and expects to
 * still be there tomorrow, on another machine, attached to the thing they
 * annotated. It has its own store so it can be swapped wholesale when the
 * server-backed version lands, without touching the rest of the app state.
 *
 * Persisted to localStorage for now. The server already accepts this exact shape
 * at PUT /api/me/tables/:tableKey and PUT /api/me/layers/:layerId, so moving it
 * to Postgres is a change of where `persist()` writes, not a schema change.
 */
import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { normStyle } from '../lib/richText';
import type { Annotation } from '../types';

/* Annotation itself lives in types/index.ts, because the drawing and
 * display-area shapes embed it. Re-exported here so components that only care
 * about annotations do not have to import from two places. */
export type { Annotation };
export type RichTextStyle = NonNullable<Annotation['style']>;

/** table key -> column key -> annotation */
export type ColumnAnnotations = Record<string, Record<string, Annotation>>;
/** drawing / display-area id -> annotation */
export type LayerAnnotations = Record<string, Annotation>;

interface AnnotState {
  cols: ColumnAnnotations;
  layers: LayerAnnotations;
  setColumn: (tableKey: string, columnKey: string, a: Annotation | null) => void;
  setLayer: (layerId: string | number, a: Annotation | null) => void;
  clearAll: () => void;
}

export const useAnnotations = create<AnnotState>()(
  persist(
    (set) => ({
      cols: {},
      layers: {},

      setColumn: (tableKey, columnKey, a) => set((st) => {
        const forTable = { ...(st.cols[tableKey] ?? {}) };
        /* null removes the override entirely, so the column goes back to its
           built-in label and styling. */
        if (a === null) delete forTable[columnKey];
        else forTable[columnKey] = { ...a, style: normStyle(a.style) };
        return { cols: { ...st.cols, [tableKey]: forTable } };
      }),

      setLayer: (layerId, a) => set((st) => {
        const key = String(layerId);
        const next = { ...st.layers };
        if (a === null) delete next[key];
        else next[key] = { ...a, style: normStyle(a.style) };
        return { layers: next };
      }),

      clearAll: () => set({ cols: {}, layers: {} }),
    }),
    { name: 'landmap.annotations.v1' },
  ),
);

/** Hook form: the annotation for one column, or undefined. */
export const useColumnAnnotation = (tableKey: string, columnKey: string): Annotation | undefined =>
  useAnnotations(s => s.cols[tableKey]?.[columnKey]);

/** Hook form: the annotation for one drawing or display area. */
export const useLayerAnnotation = (id: string | number): Annotation | undefined =>
  useAnnotations(s => s.layers[String(id)]);

/** True when the user has overridden anything about a column, which is what the
 *  header uses to decide whether to offer a "reset" affordance. */
export const hasColumnOverride = (a: Annotation | undefined): boolean =>
  !!a && (!!a.name || !!a.note || Object.keys(a.style ?? {}).length > 0);
