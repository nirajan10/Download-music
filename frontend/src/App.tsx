import { Route, Routes } from "react-router-dom";
import { ActiveSessionsBanner } from "./components/ActiveSessionsBanner";
import { DownloadForm } from "./components/DownloadForm";
import { Report } from "./components/Report";
import { Sidebar } from "./components/Sidebar";

export default function App() {
  return (
    <div className="flex min-h-screen bg-gray-950 text-white">
      <Sidebar />
      <main className="flex-1 flex flex-col overflow-hidden">
        <Routes>
          <Route
            path="/"
            element={
              <div className="flex-1 flex flex-col items-center px-8 py-16">
                <ActiveSessionsBanner />
                <DownloadForm />
              </div>
            }
          />
          <Route path="/session/:id" element={<Report />} />
        </Routes>
      </main>
    </div>
  );
}
