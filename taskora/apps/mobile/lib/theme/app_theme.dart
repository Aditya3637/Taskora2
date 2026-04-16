import 'package:flutter/material.dart';
import 'app_colors.dart';
import 'app_text_styles.dart';

abstract class AppTheme {
  static ThemeData get light => ThemeData(
        useMaterial3: true,
        colorScheme: ColorScheme.fromSeed(
          seedColor: AppColors.taskoraRed,
          primary: AppColors.taskoraRed,
          surface: AppColors.white,
          background: AppColors.mist,
        ),
        scaffoldBackgroundColor: AppColors.mist,
        appBarTheme: const AppBarTheme(
          backgroundColor: AppColors.white,
          foregroundColor: AppColors.midnight,
          elevation: 0,
          centerTitle: false,
          titleTextStyle: AppTextStyles.headlineMedium,
        ),
        textTheme: const TextTheme(
          displayLarge: AppTextStyles.displayLarge,
          headlineMedium: AppTextStyles.headlineMedium,
          titleMedium: AppTextStyles.titleMedium,
          bodyMedium: AppTextStyles.bodyMedium,
          labelSmall: AppTextStyles.labelSmall,
        ),
        cardTheme: CardTheme(
          elevation: 0,
          shape: RoundedRectangleBorder(
            borderRadius: BorderRadius.circular(16),
            side: const BorderSide(color: AppColors.pebble),
          ),
          color: AppColors.white,
        ),
      );

  static ThemeData get dark => ThemeData(
        useMaterial3: true,
        colorScheme: ColorScheme.fromSeed(
          seedColor: AppColors.taskoraRed,
          brightness: Brightness.dark,
          primary: AppColors.taskoraRed,
          surface: AppColors.deepNavy,
          background: AppColors.midnight,
        ),
        scaffoldBackgroundColor: AppColors.midnight,
      );
}
