import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';
import '../theme/app_colors.dart';
import '../theme/app_text_styles.dart';

class ShellScreen extends StatelessWidget {
  final Widget child;
  const ShellScreen({super.key, required this.child});

  int _currentIndex(BuildContext context) {
    final location = GoRouterState.of(context).matchedLocation;
    if (location.startsWith('/daily-brief')) return 0;
    if (location.startsWith('/war-room')) return 1;
    if (location.startsWith('/initiatives')) return 2;
    if (location.startsWith('/profile')) return 3;
    return 0;
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      body: child,
      bottomNavigationBar: BottomNavigationBar(
        currentIndex: _currentIndex(context),
        type: BottomNavigationBarType.fixed,
        backgroundColor: AppColors.white,
        selectedItemColor: AppColors.taskoraRed,
        unselectedItemColor: AppColors.steel,
        selectedLabelStyle: AppTextStyles.labelSmall.copyWith(
          color: AppColors.taskoraRed,
          fontWeight: FontWeight.w600,
        ),
        unselectedLabelStyle: AppTextStyles.labelSmall,
        onTap: (index) {
          switch (index) {
            case 0: context.go('/daily-brief'); break;
            case 1: context.go('/war-room'); break;
            case 2: context.go('/initiatives'); break;
            case 3: context.go('/profile'); break;
          }
        },
        items: const [
          BottomNavigationBarItem(icon: Icon(Icons.today_outlined), activeIcon: Icon(Icons.today), label: 'Daily Brief'),
          BottomNavigationBarItem(icon: Icon(Icons.bolt_outlined), activeIcon: Icon(Icons.bolt), label: 'War Room'),
          BottomNavigationBarItem(icon: Icon(Icons.rocket_launch_outlined), activeIcon: Icon(Icons.rocket_launch), label: 'Initiatives'),
          BottomNavigationBarItem(icon: Icon(Icons.person_outline), activeIcon: Icon(Icons.person), label: 'Profile'),
        ],
      ),
    );
  }
}
