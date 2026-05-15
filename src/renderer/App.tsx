import React from 'react';
import { ConfigProvider } from 'antd';
import zhCN from 'antd/locale/zh_CN';
import TermManager from './pages/TermManager';
import './App.css';

function useErrorSniffer(setError: (message: string) => void) {
  React.useEffect(() => {
    const handleError = (event: Event | string | any) => {
      const msg = event instanceof ErrorEvent
        ? `${event.message} (${event.filename}:${event.lineno}:${event.colno})`
        : event?.reason?.message || String(event);
      setError(msg);
      console.error('Caught global error:', event);
      return false;
    };

    const handleRejection = (event: PromiseRejectionEvent) => {
      const msg = event.reason ? (event.reason.message || String(event.reason)) : 'Unknown promise rejection';
      setError(`Unhandled promise rejection: ${msg}`);
      console.error('Unhandled rejection:', event.reason);
      return false;
    };

    window.addEventListener('error', handleError as any);
    window.addEventListener('unhandledrejection', handleRejection as any);

    return () => {
      window.removeEventListener('error', handleError as any);
      window.removeEventListener('unhandledrejection', handleRejection as any);
    };
  }, [setError]);
}

function App() {
  const [errorMessage, setErrorMessage] = React.useState<string | null>(null);
  useErrorSniffer(setErrorMessage);

  return (
    <ConfigProvider locale={zhCN}>
      <div className="app-container">
        {errorMessage ? (
          <div style={{ padding: 24, color: '#f5222d' }}>
            <h2>渲染错误（调试信息）</h2>
            <pre style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>{errorMessage}</pre>
          </div>
        ) : (
          <TermManager />
        )}
      </div>
    </ConfigProvider>
  );
}

export default App;
