import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'screens/shell_screen.dart';
import 'screens/daily_brief_screen.dart';
import 'screens/my_tasks_screen.dart';
import 'screens/task_detail_screen.dart';
import 'screens/war_room_screen.dart';
import 'screens/reports_screen.dart';
import 'screens/whatsapp_screen.dart';

final routerProvider = Provider<GoRouter>((ref) {
  return GoRouter(
    initialLocation: '/daily-brief',
    routes: [
      ShellRoute(
        builder: (context, state, child) => ShellScreen(child: child),
        routes: [
          GoRoute(
            path: '/daily-brief',
            builder: (context, state) => const DailyBriefScreen(),
          ),
          GoRoute(
            path: '/war-room',
            builder: (context, state) => const WarRoomScreen(),
          ),
          GoRoute(
            path: '/tasks',
            builder: (context, state) => const MyTasksScreen(),
          ),
          GoRoute(
            path: '/reports',
            builder: (context, state) => const ReportsScreen(),
          ),
          GoRoute(
            path: '/whatsapp',
            builder: (context, state) => const WhatsAppScreen(),
          ),
          GoRoute(
            path: '/initiatives',
            builder: (context, state) => const Scaffold(
              body: Center(child: Text('Initiatives — coming soon')),
            ),
          ),
          GoRoute(
            path: '/profile',
            builder: (context, state) => const Scaffold(
              body: Center(child: Text('Profile — coming soon')),
            ),
          ),
        ],
      ),
      // Full-screen routes (outside bottom nav shell)
      GoRoute(
        path: '/tasks/:taskId',
        builder: (context, state) =>
            TaskDetailScreen(taskId: state.pathParameters['taskId']!),
      ),
    ],
  );
});
