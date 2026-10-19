import { hint } from '../../ui/styles';

/* Hint - the small grey explainer under a settings row. Used by more than one
 * pane, so it needs a home of its own rather than riding along in one of them. */
export const Hint = ({ children }: { children: React.ReactNode }) => <div className={hint}>{children}</div>;
// const B = ({ children }: { children: React.ReactNode }) => <b className="text-ink">{children}</b>;
