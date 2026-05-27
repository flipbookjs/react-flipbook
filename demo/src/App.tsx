import { Flipbook } from '@flipbookjs/react-viewer';
import '@flipbookjs/react-viewer/styles.css';

function App() {
  return (
    <div style={{ width: '100%', height: '100%' }}>
      <Flipbook
        url="/LDEO%20Annual%20Report%202021%20-%20Print%20Version.pdf"
        viewMode="auto"
        enablePageCurl
      />
    </div>
  );
}

export default App;
