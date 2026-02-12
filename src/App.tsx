import { useEffect, useState } from "react";
import "./App.css";
import WelcomeScreen from "./components/WelcomeScreen";
import { getLastOpenedVault, initConfig } from "./utils/config";

function App() {
  const [vaultPath, setVaultPath] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    async function loadConfig() {
      try {
        await initConfig();
        const path = await getLastOpenedVault();
        if (path) {
          setVaultPath(path);
        }
      } catch (error) {
        console.error("Failed to load config:", error);
      } finally {
        setIsLoading(false);
      }
    }
    loadConfig();
  }, []);

  if (isLoading) {
    return <div className="container">Loading configuration...</div>;
  }

  if (!vaultPath) {
    return <WelcomeScreen onVaultOpened={(path) => setVaultPath(path)} />;
  }

  return (
    <main className="container">
      <h1>Rustmate Workspace</h1>
      <p>Current Vault: {vaultPath}</p>

      {/* TODO: Implement 3-column layout here */}
      <div style={{ marginTop: '2rem', padding: '1rem', border: '1px solid #ccc' }}>
        <p>Library | Chat | Inspector</p>
      </div>

      <button onClick={() => setVaultPath(null)} style={{ marginTop: '20px' }}>
        Close Vault (Debug)
      </button>
    </main>
  );
}

export default App;
