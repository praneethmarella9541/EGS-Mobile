import { useState } from 'react';
import { View, Text, TextInput, TouchableOpacity, Alert, ScrollView } from 'react-native';
import { useAuth } from '../../src/context/AuthContext';
import { colors, shared } from '../../src/styles';
import { API_URL } from '../../src/config';

export default function LoginScreen() {
  const { login } = useAuth();
  const [email, setEmail] = useState('admin@company.com');
  const [password, setPassword] = useState('admin123');
  const [loading, setLoading] = useState(false);

  const handleLogin = async () => {
    setLoading(true);
    try {
      await login(email.trim(), password);
    } catch (err: any) {
      Alert.alert('Login Failed', err.response?.data?.error || err.message || 'Could not login');
    } finally {
      setLoading(false);
    }
  };

  return (
    <ScrollView style={shared.container} contentContainerStyle={{ flexGrow: 1, justifyContent: 'center', padding: 24 }}>
      <Text style={[shared.title, { fontSize: 28, textAlign: 'center' }]}>Sales Attendance</Text>
      <Text style={[shared.subtitle, { textAlign: 'center', marginBottom: 32 }]}>Face + GPS Verified Attendance</Text>

      <Text style={shared.label}>Email</Text>
      <TextInput style={shared.input} value={email} onChangeText={setEmail} autoCapitalize="none" keyboardType="email-address" placeholderTextColor={colors.muted} />

      <Text style={shared.label}>Password</Text>
      <TextInput style={shared.input} value={password} onChangeText={setPassword} secureTextEntry placeholderTextColor={colors.muted} />

      <TouchableOpacity style={shared.btn} onPress={handleLogin} disabled={loading}>
        <Text style={shared.btnText}>{loading ? 'Signing in...' : 'Sign In'}</Text>
      </TouchableOpacity>

      <View style={[shared.card, { marginTop: 24 }]}>
        <Text style={shared.cardTitle}>Demo Accounts</Text>
        <Text style={shared.cardSub}>Admin: admin@company.com / admin123</Text>
        <Text style={shared.cardSub}>Sales: john@company.com / sales123</Text>
        <Text style={[shared.cardSub, { marginTop: 8, fontSize: 11 }]}>API: {API_URL}</Text>
      </View>
    </ScrollView>
  );
}
