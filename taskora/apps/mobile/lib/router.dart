import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'screens/shell_screen.dart';
import 'screens/daily_brief_screen.dart';

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
            builder: (context, state) => const Scaffold(body: Center(child: Text('War Room'))),
          ),
          GoRoute(
            path: '/initiatives',
            builder: (context, state) => const Scaffold(body: Center(child: Text('Initiatives'))),
          ),
          GoRoute(
            path: '/profile',
            builder: (context, state) => const Scaffold(body: Center(child: Text('Profile'))),
          ),
        ],
      ),
    ],
  );
});
