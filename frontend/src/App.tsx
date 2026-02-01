import { Routes, Route, Navigate } from "react-router-dom";
import Upload from "./pages/Upload";
import Review from "./pages/Review";
import Summary from "./pages/Summary";
import TopNav from "./components/TopNav";

export default function App() {
  return (
    <>
    <TopNav />
    <Routes>
      <Route path="/" element={<Navigate to="/upload" replace />} />
      <Route path="/upload" element={<Upload />} />
      <Route path="/review" element={<Review />} />
      <Route path="/summary" element={<Summary />} />
    </Routes></>
  );
}
