import { useCallback, useState } from 'react';
import { View, Text, ScrollView, TextInput, TouchableOpacity, Alert, RefreshControl } from 'react-native';
import { useFocusEffect } from 'expo-router';
import * as Location from 'expo-location';
import { adminApi } from '../../src/api';
import { colors, shared } from '../../src/styles';

export default function LocationsScreen() {
  const [locations, setLocations] = useState<any[]>([]);
  const [users, setUsers] = useState<any[]>([]);
  const [showForm, setShowForm] = useState(false);
  const [name, setName] = useState('');
  const [address, setAddress] = useState('');
  const [lat, setLat] = useState('');
  const [lng, setLng] = useState('');
  const [assignedTo, setAssignedTo] = useState('');
  const [refreshing, setRefreshing] = useState(false);

  const load = async () => {
    const [locRes, userRes] = await Promise.all([adminApi.getLocations(), adminApi.getUsers()]);
    setLocations(locRes.data);
    setUsers(userRes.data);
  };

  useFocusEffect(useCallback(() => { load(); }, []));

  const useCurrentLocation = async () => {
    const { status } = await Location.requestForegroundPermissionsAsync();
    if (status !== 'granted') return Alert.alert('Permission needed', 'Location permission required');
    const loc = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.High });
    setLat(loc.coords.latitude.toFixed(6));
    setLng(loc.coords.longitude.toFixed(6));
  };

  const create = async () => {
    if (!name || !lat || !lng) return Alert.alert('Error', 'Name and coordinates required');
    try {
      await adminApi.createLocation({
        name, address, latitude: parseFloat(lat), longitude: parseFloat(lng),
        assigned_to: assignedTo || null, radius_meters: 100,
      });
      setShowForm(false);
      setName(''); setAddress(''); setLat(''); setLng(''); setAssignedTo('');
      load();
      Alert.alert('Success', 'Location created');
    } catch (err: any) {
      Alert.alert('Error', err.response?.data?.error || err.message);
    }
  };

  return (
    <ScrollView style={shared.container} contentContainerStyle={shared.content} refreshControl={<RefreshControl refreshing={refreshing} onRefresh={async () => { setRefreshing(true); await load(); setRefreshing(false); }} />}>
      <Text style={shared.title}>Locations</Text>
      <Text style={shared.subtitle}>Assign work locations to sales people (100m radius)</Text>

      <TouchableOpacity style={shared.btn} onPress={() => setShowForm(!showForm)}>
        <Text style={shared.btnText}>{showForm ? 'Cancel' : '+ Add Location'}</Text>
      </TouchableOpacity>

      {showForm && (
        <View style={[shared.card, { marginTop: 12 }]}>
          <TextInput style={shared.input} placeholder="Location Name" placeholderTextColor={colors.muted} value={name} onChangeText={setName} />
          <TextInput style={shared.input} placeholder="Address" placeholderTextColor={colors.muted} value={address} onChangeText={setAddress} />
          <TextInput style={shared.input} placeholder="Latitude" placeholderTextColor={colors.muted} value={lat} onChangeText={setLat} keyboardType="numeric" />
          <TextInput style={shared.input} placeholder="Longitude" placeholderTextColor={colors.muted} value={lng} onChangeText={setLng} keyboardType="numeric" />
          <TouchableOpacity style={shared.btnOutline} onPress={useCurrentLocation}>
            <Text style={{ color: colors.primary }}>Use Current GPS Location</Text>
          </TouchableOpacity>
          <Text style={shared.label}>Assign to Sales Person</Text>
          {users.map((u) => (
            <TouchableOpacity key={u.id} style={[shared.btnOutline, assignedTo === u.id && { borderColor: colors.primary }]} onPress={() => setAssignedTo(u.id)}>
              <Text style={{ color: assignedTo === u.id ? colors.primary : colors.text }}>{u.name}</Text>
            </TouchableOpacity>
          ))}
          <TouchableOpacity style={shared.btn} onPress={create}>
            <Text style={shared.btnText}>Save Location</Text>
          </TouchableOpacity>
        </View>
      )}

      {locations.map((loc) => (
        <View key={loc.id} style={shared.card}>
          <Text style={shared.cardTitle}>{loc.name}</Text>
          <Text style={shared.cardSub}>{loc.address || 'No address'}</Text>
          <Text style={shared.cardSub}>📍 {loc.latitude}, {loc.longitude} • {loc.radius_meters}m radius</Text>
          <Text style={shared.cardSub}>Assigned: {loc.assigned_to_name || 'Unassigned'}</Text>
        </View>
      ))}
    </ScrollView>
  );
}
