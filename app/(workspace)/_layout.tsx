import React, { createContext, useContext, useState } from 'react';
import { Stack, useRouter, usePathname } from 'expo-router';
import { Drawer } from 'react-native-drawer-layout';
import { View, Text, TouchableOpacity, StyleSheet, ScrollView } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { Colors } from '../../constants/colors';
import { useAuth } from '../../hooks/useAuth';
import { BrandLogo } from '../../components/BrandLogo';

type Module = {
  key: string;
  label: string;
  icon: keyof typeof Ionicons.glyphMap;
  path: string;
  /** Which roles see this item. */
  roles: ('admin' | 'user')[];
};

const MODULES: Module[] = [
  { key: 'assignments', label: 'Assignments', icon: 'clipboard-outline', path: '/(workspace)/assignments', roles: ['admin'] },
  { key: 'tasks', label: 'My Tasks', icon: 'checkbox-outline', path: '/(workspace)/tasks', roles: ['user'] },
  { key: 'admin', label: 'Team', icon: 'people-outline', path: '/(workspace)/admin', roles: ['admin'] },
];

interface DrawerCtx {
  openDrawer: () => void;
  closeDrawer: () => void;
}
export const DrawerContext = createContext<DrawerCtx>({ openDrawer: () => {}, closeDrawer: () => {} });
export function useDrawer() {
  return useContext(DrawerContext);
}

function SidebarContent({ onClose }: { onClose: () => void }) {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const pathname = usePathname();
  const { profile, user, isAdmin, signOut } = useAuth();

  const name = profile?.display_name || user?.email?.split('@')[0] || 'User';
  const email = profile?.email || user?.email || '';
  const role: 'admin' | 'user' = isAdmin ? 'admin' : 'user';

  const navigate = (path: string) => {
    onClose();
    router.push(path as any);
  };

  const visible = MODULES.filter((m) => m.roles.includes(role));

  return (
    <View style={[styles.sidebar, { paddingTop: insets.top + 16 }]}>
      <View style={styles.sidebarHeader}>
        <BrandLogo size="sm" nameColor={Colors.sidebarActiveText} />
      </View>

      <View style={styles.profileRow}>
        <View style={styles.avatar}>
          <Text style={styles.avatarText}>{name.charAt(0).toUpperCase()}</Text>
        </View>
        <View style={{ flex: 1 }}>
          <Text style={styles.profileName} numberOfLines={1}>
            {name}
          </Text>
          <Text style={styles.profileEmail} numberOfLines={1}>
            {email}
          </Text>
        </View>
        {isAdmin && (
          <View style={styles.roleBadge}>
            <Text style={styles.roleBadgeText}>Admin</Text>
          </View>
        )}
      </View>

      <ScrollView style={{ flex: 1 }} contentContainerStyle={styles.navList}>
        {visible.map((m) => {
          const active = pathname.includes(`/${m.key}`);
          return (
            <TouchableOpacity
              key={m.key}
              style={[styles.navItem, active && styles.navItemActive]}
              onPress={() => navigate(m.path)}
              activeOpacity={0.8}
            >
              <Ionicons
                name={m.icon}
                size={20}
                color={active ? Colors.sidebarActiveText : Colors.sidebarText}
              />
              <Text style={[styles.navLabel, active && styles.navLabelActive]}>{m.label}</Text>
            </TouchableOpacity>
          );
        })}
      </ScrollView>

      <TouchableOpacity
        style={[styles.signOut, { marginBottom: insets.bottom + 12 }]}
        onPress={signOut}
        activeOpacity={0.8}
      >
        <Ionicons name="log-out-outline" size={20} color={Colors.sidebarText} />
        <Text style={styles.signOutText}>Sign out</Text>
      </TouchableOpacity>
    </View>
  );
}

export default function WorkspaceLayout() {
  const [open, setOpen] = useState(false);

  return (
    <DrawerContext.Provider value={{ openDrawer: () => setOpen(true), closeDrawer: () => setOpen(false) }}>
      <Drawer
        open={open}
        onOpen={() => setOpen(true)}
        onClose={() => setOpen(false)}
        drawerType="front"
        drawerStyle={{ backgroundColor: Colors.sidebar, width: 280 }}
        renderDrawerContent={() => <SidebarContent onClose={() => setOpen(false)} />}
      >
        <Stack screenOptions={{ headerShown: false }} />
      </Drawer>
    </DrawerContext.Provider>
  );
}

const styles = StyleSheet.create({
  sidebar: { flex: 1, backgroundColor: Colors.sidebar, paddingHorizontal: 16 },
  sidebarHeader: { paddingBottom: 16 },
  profileRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 14,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(255,255,255,0.08)',
  },
  avatar: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: Colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarText: { color: '#fff', fontWeight: '700', fontSize: 16 },
  profileName: { color: Colors.sidebarActiveText, fontWeight: '600', fontSize: 15 },
  profileEmail: { color: Colors.sidebarText, fontSize: 12, marginTop: 2 },
  roleBadge: {
    backgroundColor: Colors.primary,
    borderRadius: 6,
    paddingHorizontal: 8,
    paddingVertical: 3,
  },
  roleBadgeText: { color: '#fff', fontSize: 10, fontWeight: '700', letterSpacing: 0.5 },
  navList: { paddingTop: 12, gap: 4 },
  navItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    paddingVertical: 12,
    paddingHorizontal: 12,
    borderRadius: 10,
  },
  navItemActive: { backgroundColor: Colors.sidebarItem },
  navLabel: { color: Colors.sidebarText, fontSize: 15, fontWeight: '500' },
  navLabelActive: { color: Colors.sidebarActiveText, fontWeight: '600' },
  signOut: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    paddingVertical: 12,
    paddingHorizontal: 12,
    borderRadius: 10,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(255,255,255,0.08)',
  },
  signOutText: { color: Colors.sidebarText, fontSize: 15, fontWeight: '500' },
});
