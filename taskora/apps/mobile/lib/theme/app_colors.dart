import 'package:flutter/material.dart';

abstract class AppColors {
  // Brand
  static const taskoraRed = Color(0xFFE63946);
  static const taskoraRedHover = Color(0xFFC62828);

  // Dark palette
  static const midnight = Color(0xFF1A1A2E);
  static const deepNavy = Color(0xFF16213E);
  static const ocean = Color(0xFF0F3460);

  // Neutral
  static const steel = Color(0xFF6B7280);
  static const mist = Color(0xFFF3F4F6);
  static const pebble = Color(0xFFE5E7EB);
  static const white = Color(0xFFFFFFFF);

  // Status
  static const statusDone = Color(0xFF22C55E);       // green-500
  static const statusInProgress = Color(0xFF3B82F6); // blue-500
  static const statusBlocked = Color(0xFFE63946);    // taskora-red
  static const statusPending = Color(0xFFA855F7);    // purple-500
}
