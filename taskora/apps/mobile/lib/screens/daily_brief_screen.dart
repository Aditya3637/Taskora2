import 'package:flutter/material.dart';
import '../theme/app_colors.dart';
import '../theme/app_text_styles.dart';
import '../models/daily_brief.dart';

class DailyBriefScreen extends StatelessWidget {
  const DailyBriefScreen({super.key});

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        title: const Text('Daily Brief'),
        actions: [
          IconButton(
            icon: const Icon(Icons.refresh_outlined),
            onPressed: () {},
          ),
        ],
      ),
      body: ListView(
        padding: const EdgeInsets.all(16),
        children: const [
          _SectionHeader(title: '🔴 Decisions Pending', count: 0),
          SizedBox(height: 8),
          _EmptySlate(message: 'No decisions awaiting your action'),
          SizedBox(height: 16),
          _SectionHeader(title: '⏰ Overdue', count: 0),
          SizedBox(height: 8),
          _EmptySlate(message: 'No overdue tasks'),
          SizedBox(height: 16),
          _SectionHeader(title: '📅 Due This Week', count: 0),
          SizedBox(height: 8),
          _EmptySlate(message: 'Nothing due this week'),
          SizedBox(height: 16),
          _SectionHeader(title: '🚫 Blocked', count: 0),
          SizedBox(height: 8),
          _EmptySlate(message: 'No blocked tasks'),
        ],
      ),
    );
  }
}

class _SectionHeader extends StatelessWidget {
  final String title;
  final int count;
  const _SectionHeader({required this.title, required this.count});

  @override
  Widget build(BuildContext context) {
    return Row(
      children: [
        Text(title, style: AppTextStyles.titleMedium),
        const Spacer(),
        if (count > 0)
          Container(
            padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 2),
            decoration: BoxDecoration(
              color: AppColors.taskoraRed,
              borderRadius: BorderRadius.circular(12),
            ),
            child: Text(
              '$count',
              style: const TextStyle(color: AppColors.white, fontSize: 12, fontWeight: FontWeight.w700),
            ),
          ),
      ],
    );
  }
}

class _EmptySlate extends StatelessWidget {
  final String message;
  const _EmptySlate({required this.message});

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.symmetric(vertical: 20),
      decoration: BoxDecoration(
        color: AppColors.white,
        borderRadius: BorderRadius.circular(12),
        border: Border.all(color: AppColors.pebble),
      ),
      child: Center(
        child: Text(message, style: AppTextStyles.bodyMedium),
      ),
    );
  }
}

class TaskCard extends StatelessWidget {
  final DailyBriefTask task;
  const TaskCard({super.key, required this.task});

  Color _priorityColor() {
    switch (task.priority) {
      case 'critical': return AppColors.taskoraRed;
      case 'high': return Colors.orange;
      case 'medium': return AppColors.ocean;
      default: return AppColors.steel;
    }
  }

  @override
  Widget build(BuildContext context) {
    return Card(
      margin: const EdgeInsets.only(bottom: 8),
      child: Padding(
        padding: const EdgeInsets.all(14),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(
              children: [
                Expanded(child: Text(task.title, style: AppTextStyles.titleMedium)),
                Container(
                  padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 2),
                  decoration: BoxDecoration(
                    color: _priorityColor().withOpacity(0.1),
                    borderRadius: BorderRadius.circular(8),
                  ),
                  child: Text(
                    task.priority,
                    style: TextStyle(fontSize: 11, fontWeight: FontWeight.w600, color: _priorityColor()),
                  ),
                ),
              ],
            ),
            if (task.dueDate != null) ...[
              const SizedBox(height: 4),
              Text('Due: ${task.dueDate}', style: AppTextStyles.labelSmall),
            ],
          ],
        ),
      ),
    );
  }
}
