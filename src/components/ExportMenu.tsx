import { downloadStl } from '../lib/export/stl';
import styles from './ExportMenu.module.css';

interface Props {
  stlBuffer: ArrayBuffer | null;
  generating: boolean;
}

export function ExportMenu({ stlBuffer, generating }: Props) {
  const disabled = generating || !stlBuffer;

  return (
    <button
      className={styles.button}
      disabled={disabled}
      onClick={() => stlBuffer && downloadStl(stlBuffer)}
      title={disabled ? 'Waiting for geometry…' : 'Download STL file'}
    >
      Export STL
    </button>
  );
}
