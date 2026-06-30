import { useAuth } from "@/hooks/useAuth";
import AuthPage from "@/components/AuthPage";
import ChatPage from "@/components/ChatPage";
import AppLock from "@/components/AppLock";

export default function Index() {
  const { user, loading } = useAuth();

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <div className="w-6 h-6 border-2 border-primary border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  return <AppLock>{user ? <ChatPage /> : <AuthPage />}</AppLock>;
}
