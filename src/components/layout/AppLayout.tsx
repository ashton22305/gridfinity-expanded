import type { ReactNode } from 'react';
import styles from './AppLayout.module.css';

interface Props {
  header: ReactNode;
  sidebar: ReactNode;
  viewer: ReactNode;
}

export function AppLayout({ header, sidebar, viewer }: Props) {
  return (
    <div className={styles.root}>
      <header className={styles.header}>{header}</header>
      <div className={styles.body}>
        {sidebar}
        <main className={styles.viewerPane}>{viewer}</main>
      </div>
    </div>
  );
}
