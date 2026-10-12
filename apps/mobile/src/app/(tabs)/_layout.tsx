/** Bottom tabs: Attendance (first) · Leave · Holidays · More. Tasks and Assets tabs come in later steps (PLAN.md §19.16). */
import { Ionicons } from '@expo/vector-icons';
import { Tabs } from 'expo-router';
import type { ComponentProps } from 'react';
import { FONTS, useTheme } from '@/lib/theme';

type Icon = ComponentProps<typeof Ionicons>['name'];

const TABS: Array<{ name: string; title: string; icon: Icon; active: Icon }> = [
  { name: 'attendance', title: 'Attendance', icon: 'finger-print-outline', active: 'finger-print' },
  { name: 'leave', title: 'Leave', icon: 'calendar-outline', active: 'calendar' },
  { name: 'holidays', title: 'Holidays', icon: 'sunny-outline', active: 'sunny' },
  { name: 'more', title: 'More', icon: 'person-circle-outline', active: 'person-circle' },
];

export default function TabsLayout() {
  const { colors } = useTheme();
  return (
    <Tabs
      initialRouteName="attendance"
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: colors.primary,
        tabBarInactiveTintColor: colors.mutedForeground,
        tabBarStyle: { backgroundColor: colors.card, borderTopColor: colors.border, minHeight: 64 },
        tabBarLabelStyle: { fontFamily: FONTS.semibold, fontSize: 12.5 },
        tabBarItemStyle: { minHeight: 56, paddingTop: 4 },
      }}
    >
      {TABS.map((t) => (
        <Tabs.Screen
          key={t.name}
          name={t.name}
          options={{
            title: t.title,
            tabBarAccessibilityLabel: t.title,
            tabBarIcon: ({ color, focused, size }) => <Ionicons name={focused ? t.active : t.icon} size={size + 2} color={color} />,
          }}
        />
      ))}
    </Tabs>
  );
}
