import { useState } from "react";
import { useAuth } from "@/hooks/useAuth";
import AuthPage from "@/components/AuthPage";
import ChatPage from "@/components/ChatPage";
import LockScreen from "@/components/LockScreen";

export default function Index() {
  const { user, loading } = useAuth();
  const [unlocked, setUnlocked] = useState(false);

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <div className="w-6 h-6 border-2 border-primary border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  if (!unlocked) return <LockScreen onUnlock={() => setUnlocked(true)} />;

  return user ? <ChatPage /> : <AuthPage />;
}
