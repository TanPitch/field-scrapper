import { useCallback, useState } from 'react';
import { Confirm, type ConfirmOpts, type ConfirmState } from '../components/ui/Confirm';

/** Holds the one Confirm dialog the app renders. */
export function useConfirm() {
  const [state, setState] = useState<ConfirmState | null>(null);

  const close = useCallback(() => setState(null), []);

  /** Resolves true when the user confirms, false when they cancel. */
  const confirm = useCallback((opts: ConfirmOpts) => new Promise<boolean>(resolve => {
    setState({ ...opts, resolve });
  }), []);

  return { confirm, dialog: <Confirm state={state} close={close} /> };
}
