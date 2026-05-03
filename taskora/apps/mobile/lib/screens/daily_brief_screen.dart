import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';
import '../theme/app_colors.dart';
import '../theme/app_text_styles.dart';
import '../models/daily_brief.dart';
import '../services/api_service.dart';

class DailyBriefScreen extends StatefulWidget {
  const DailyBriefScreen({super.key});

  @override
  State<DailyBriefScreen> createState() => _DailyBriefScreenState();
}

class _DailyBriefScreenState extends State<DailyBriefScreen> {
  final _api = ApiService();
  DailyBriefResponse? _brief;
  bool _loading = true;
  String? _error;

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    setState(() { _loading = true; _error = null; });
    try {
      final data = await _api.get('/api/v1/daily-brief/');
      setState(() { _brief = DailyBriefResponse.fromJson(data); _loading = false; });
    } catch (e) {
      setState(() { _error = e.toString(); _loading = false; });
    }
  }

  Future<void> _approveTask(DailyBriefTask task) async {
    try {
      await _api.post('/api/v1/tasks/${task.id}/decisions', {'action': 'approve'});
      if (mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text('"${task.title}" approved ✓')));
      _load();
    } catch (e) {
      if (mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text('Failed: $e')));
    }
  }

  void _showSnoozeSheet(DailyBriefTask task) {
    final options = {'1 hour': 1, '4 hours': 4, '24 hours': 24};
    showModalBottomSheet(
      context: context,
      builder: (_) => Column(
        mainAxisSize: MainAxisSize.min,
        children: [
          const ListTile(title: Text('Snooze for', style: TextStyle(fontWeight: FontWeight.w700))),
          ...options.entries.map((e) => ListTile(
            title: Text(e.key),
            onTap: () async {
              Navigator.pop(context);
              try {
                await _api.post('/api/v1/tasks/${task.id}/decisions',
                    {'action': 'snooze', 'snooze_hours': e.value});
                if (mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text('Snoozed for ${e.key}')));
                _load();
              } catch (err) {
                if (mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text('Failed: $err')));
              }
            },
          )),
          const SizedBox(height: 12),
        ],
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        title: const Text('Daily Brief'),
        actions: [
          IconButton(
            icon: const Icon(Icons.send, color: Color(0xFF25D366)),
            tooltip: 'WhatsApp Digest',
            onPressed: () => context.push('/whatsapp'),
          ),
          IconButton(icon: const Icon(Icons.refresh), onPressed: _load),
        ],
      ),
      body: _loading
          ? const Center(child: CircularProgressIndicator())
          : _error != null
              ? Center(child: Column(mainAxisSize: MainAxisSize.min, children: [
                  Text('Failed to load', style: AppTextStyles.bodyMedium),
                  const SizedBox(height: 8),
                  ElevatedButton(onPressed: _load, child: const Text('Retry')),
                ]))
              : RefreshIndicator(onRefresh: _load, child: _buildContent()),
    );
  }

  Widget _buildContent() {
    final brief = _brief!;
    final qs = brief.quickStats;
    return ListView(
      padding: const EdgeInsets.all(16),
      children: [
        // Greeting
        _GreetingHeader(summaryLine: brief.greeting?.summaryLine ?? ''),
        const SizedBox(height: 16),

        // Quick stats
        if (qs != null) ...[
          Row(children: [
            Expanded(child: _QuickStatTile(label: 'Open Tasks', value: '${qs.openTasks}')),
            const SizedBox(width: 8),
            Expanded(child: _QuickStatTile(
              label: 'Done This Week',
              value: '${qs.completionRateThisWeek.toStringAsFixed(0)}%',
            )),
            const SizedBox(width: 8),
            Expanded(child: _QuickStatTile(
              label: 'Stale',
              value: '${qs.staleCount}',
              warn: qs.staleCount > 0,
            )),
          ]),
          const SizedBox(height: 20),
        ],

        // Decisions pending
        _SectionHeader(title: 'Decisions Pending', count: brief.decisionsPending.length, color: AppColors.taskoraRed),
        const SizedBox(height: 8),
        if (brief.decisionsPending.isEmpty)
          const _EmptySlate(message: 'No decisions awaiting your action')
        else
          ...brief.decisionsPending.map((t) => _SwipeableTaskCard(
            task: t,
            onApprove: () => _approveTask(t),
            onSnooze: () => _showSnoozeSheet(t),
          )),

        const SizedBox(height: 16),
        _SectionHeader(title: 'Overdue', count: brief.overdue.length, color: AppColors.statusOverdueText),
        const SizedBox(height: 8),
        if (brief.overdue.isEmpty)
          const _EmptySlate(message: 'No overdue tasks')
        else
          ...brief.overdue.map((t) => _TaskCard(task: t, showDaysOverdue: true)),

        const SizedBox(height: 16),
        _SectionHeader(title: 'Stale — Needs Update', count: brief.stale.length, color: AppColors.statusStaleText),
        const SizedBox(height: 8),
        if (brief.stale.isEmpty)
          const _EmptySlate(message: 'All tasks up to date')
        else
          ...brief.stale.map((t) => _TaskCard(task: t, showStale: true)),

        const SizedBox(height: 16),
        _SectionHeader(title: 'Due This Week', count: brief.dueThisWeek.length, color: AppColors.ocean),
        const SizedBox(height: 8),
        if (brief.dueThisWeek.isEmpty)
          const _EmptySlate(message: 'Nothing due this week')
        else
          ...brief.dueThisWeek.map((t) => _TaskCard(task: t)),

        const SizedBox(height: 16),
        _SectionHeader(title: 'Blocked', count: brief.blocked.length, color: AppColors.taskoraRed),
        const SizedBox(height: 8),
        if (brief.blocked.isEmpty)
          const _EmptySlate(message: 'No blocked tasks')
        else
          ...brief.blocked.map((t) => _TaskCard(task: t, showBlocker: true)),

        // Initiative progress
        if (brief.initiativeProgress.isNotEmpty) ...[
          const SizedBox(height: 16),
          _SectionHeader(title: 'Initiative Progress', count: brief.initiativeProgress.length, color: AppColors.midnight),
          const SizedBox(height: 8),
          ...brief.initiativeProgress.map((p) => _InitiativeCard(progress: p)),
        ],

        const SizedBox(height: 24),
      ],
    );
  }
}

class _GreetingHeader extends StatelessWidget {
  final String summaryLine;
  const _GreetingHeader({required this.summaryLine});
  @override
  Widget build(BuildContext context) {
    final hour = DateTime.now().hour;
    final greeting = hour < 12 ? 'Good morning 👋' : hour < 17 ? 'Good afternoon 👋' : 'Good evening 👋';
    return Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
      Text(greeting, style: AppTextStyles.headlineMedium),
      if (summaryLine.isNotEmpty) ...[
        const SizedBox(height: 4),
        Text(summaryLine, style: AppTextStyles.bodyMedium),
      ],
    ]);
  }
}

class _SectionHeader extends StatelessWidget {
  final String title;
  final int count;
  final Color color;
  const _SectionHeader({required this.title, required this.count, required this.color});
  @override
  Widget build(BuildContext context) => Row(children: [
    Text(title, style: AppTextStyles.titleMedium),
    const Spacer(),
    if (count > 0)
      Container(
        padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 2),
        decoration: BoxDecoration(color: color, borderRadius: BorderRadius.circular(12)),
        child: Text('$count', style: const TextStyle(color: AppColors.white, fontSize: 12, fontWeight: FontWeight.w700)),
      ),
  ]);
}

class _EmptySlate extends StatelessWidget {
  final String message;
  const _EmptySlate({required this.message});
  @override
  Widget build(BuildContext context) => Container(
    padding: const EdgeInsets.symmetric(vertical: 18),
    decoration: BoxDecoration(
      color: AppColors.white,
      borderRadius: BorderRadius.circular(8),
      border: Border.all(color: AppColors.pebble),
    ),
    child: Center(child: Text(message, style: AppTextStyles.bodyMedium)),
  );
}

class _SwipeableTaskCard extends StatelessWidget {
  final DailyBriefTask task;
  final VoidCallback onApprove;
  final VoidCallback onSnooze;
  const _SwipeableTaskCard({required this.task, required this.onApprove, required this.onSnooze});
  @override
  Widget build(BuildContext context) => Dismissible(
    key: Key(task.id),
    background: Container(
      alignment: Alignment.centerLeft, padding: const EdgeInsets.only(left: 20),
      decoration: BoxDecoration(color: AppColors.statusDoneBg, borderRadius: BorderRadius.circular(8)),
      child: const Icon(Icons.check_circle, color: AppColors.statusDoneText),
    ),
    secondaryBackground: Container(
      alignment: Alignment.centerRight, padding: const EdgeInsets.only(right: 20),
      decoration: BoxDecoration(color: AppColors.statusStaleBg, borderRadius: BorderRadius.circular(8)),
      child: const Icon(Icons.snooze, color: AppColors.statusStaleText),
    ),
    confirmDismiss: (direction) async {
      if (direction == DismissDirection.startToEnd) { onApprove(); } else { onSnooze(); }
      return false;
    },
    child: _TaskCard(task: task),
  );
}

class _TaskCard extends StatelessWidget {
  final DailyBriefTask task;
  final bool showDaysOverdue;
  final bool showStale;
  final bool showBlocker;
  const _TaskCard({required this.task, this.showDaysOverdue = false, this.showStale = false, this.showBlocker = false});

  Color _leftColor() {
    switch (task.priority) {
      case 'urgent':
      case 'critical': return AppColors.taskoraRed;
      case 'high': return const Color(0xFFF59E0B);
      default: return AppColors.ocean;
    }
  }

  @override
  Widget build(BuildContext context) {
    final entities = task.taskEntities;
    return GestureDetector(
      onTap: () => context.push('/tasks/${task.id}'),
      child: Container(
        margin: const EdgeInsets.only(bottom: 8),
        decoration: BoxDecoration(
          color: AppColors.white,
          borderRadius: BorderRadius.circular(8),
          border: Border(
            left: BorderSide(color: _leftColor(), width: 3),
            top: const BorderSide(color: AppColors.pebble),
            right: const BorderSide(color: AppColors.pebble),
            bottom: const BorderSide(color: AppColors.pebble),
          ),
          boxShadow: const [BoxShadow(color: Color(0x0A000000), blurRadius: 3, offset: Offset(0, 1))],
        ),
        padding: const EdgeInsets.all(14),
        child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
          Row(children: [
            Expanded(child: Text(task.title, style: AppTextStyles.titleMedium)),
            if (showDaysOverdue && task.daysOverdue != null)
              _Badge(text: '${task.daysOverdue}d overdue', bg: AppColors.statusOverdueBg, fg: AppColors.statusOverdueText),
            if (showStale)
              _Badge(text: 'Needs Update', bg: AppColors.statusStaleBg, fg: AppColors.statusStaleText),
          ]),
          if (task.dueDate != null) ...[
            const SizedBox(height: 4),
            Text('Due: ${task.dueDate}', style: AppTextStyles.labelSmall),
          ],
          if (showBlocker && task.blockerReason != null) ...[
            const SizedBox(height: 4),
            Text('Blocked: ${task.blockerReason}',
                style: const TextStyle(fontSize: 12, color: AppColors.statusOverdueText)),
          ],
          if (entities.isNotEmpty) ...[
            const SizedBox(height: 6),
            Wrap(
              spacing: 4,
              children: entities.take(3).map((e) => Container(
                padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 2),
                decoration: BoxDecoration(color: AppColors.mist, borderRadius: BorderRadius.circular(4)),
                child: Text(
                  e['entity_name']?.toString() ?? e['entity_id']?.toString() ?? '',
                  style: const TextStyle(fontSize: 10, color: AppColors.steel),
                ),
              )).toList(),
            ),
          ],
        ]),
      ),
    );
  }
}

class _Badge extends StatelessWidget {
  final String text;
  final Color bg;
  final Color fg;
  const _Badge({required this.text, required this.bg, required this.fg});
  @override
  Widget build(BuildContext context) => Container(
    padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 2),
    decoration: BoxDecoration(color: bg, borderRadius: BorderRadius.circular(8)),
    child: Text(text, style: TextStyle(fontSize: 10, color: fg, fontWeight: FontWeight.w600)),
  );
}

class _InitiativeCard extends StatelessWidget {
  final InitiativeProgress progress;
  const _InitiativeCard({required this.progress});
  @override
  Widget build(BuildContext context) {
    final pct = (progress.completionPct / 100).clamp(0.0, 1.0);
    return Container(
      margin: const EdgeInsets.only(bottom: 8),
      padding: const EdgeInsets.all(14),
      decoration: BoxDecoration(
        color: const Color(0xFFF9FAFB),
        borderRadius: BorderRadius.circular(8),
        border: Border.all(color: AppColors.pebble),
      ),
      child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
        Row(children: [
          Expanded(child: Text(progress.name, style: AppTextStyles.titleMedium)),
          Text('${progress.completionPct.toStringAsFixed(0)}%', style: AppTextStyles.labelSmall),
        ]),
        const SizedBox(height: 8),
        ClipRRect(
          borderRadius: BorderRadius.circular(4),
          child: LinearProgressIndicator(
            value: pct, minHeight: 6, backgroundColor: AppColors.pebble,
            valueColor: const AlwaysStoppedAnimation(AppColors.taskoraRed),
          ),
        ),
      ]),
    );
  }
}

class _QuickStatTile extends StatelessWidget {
  final String label;
  final String value;
  final bool warn;
  const _QuickStatTile({required this.label, required this.value, this.warn = false});
  @override
  Widget build(BuildContext context) => Container(
    padding: const EdgeInsets.all(12),
    decoration: BoxDecoration(
      color: warn ? AppColors.statusStaleBg : AppColors.white,
      borderRadius: BorderRadius.circular(8),
      border: Border.all(color: AppColors.pebble),
    ),
    child: Column(children: [
      Text(value, style: TextStyle(fontSize: 22, fontWeight: FontWeight.w700,
          color: warn ? AppColors.statusStaleText : AppColors.midnight)),
      const SizedBox(height: 2),
      Text(label, style: const TextStyle(fontSize: 11, color: AppColors.steel), textAlign: TextAlign.center),
    ]),
  );
}
