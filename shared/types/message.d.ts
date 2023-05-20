export type ToastMessageProps = {
  type: 'success' | 'error' | 'warning' | 'info';
  title: string;
  description?: string | undefined;
};
