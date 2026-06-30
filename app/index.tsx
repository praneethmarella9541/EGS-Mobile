import { Redirect } from 'expo-router';
import { useAuth } from '../hooks/useAuth';
import LoadingScreen from '../components/LoadingScreen';

export default function Index() {
  const { loading, isAdmin, session } = useAuth();
  if (loading) return <LoadingScreen />;
  if (!session) return <Redirect href="/(auth)/login" />;
  return <Redirect href={isAdmin ? '/(workspace)/assignments' : '/(workspace)/tasks'} />;
}
