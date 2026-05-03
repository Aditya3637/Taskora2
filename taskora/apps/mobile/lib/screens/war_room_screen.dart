import 'package:flutter/material.dart';
import '../theme/app_colors.dart';
import '../theme/app_text_styles.dart';
import '../services/api_service.dart';

class WarRoomScreen extends StatefulWidget {
  const WarRoomScreen({super.key});

  @override
  State<WarRoomScreen> createState() => _WarRoomScreenState();
}

class _WarRoomScreenState extends State<WarRoomScreen> with SingleTickerProviderStateMixin {
  final _api = ApiService();
  late final TabController _tabController;
  Map<String, dynamic>? _selectedTask;

  // Queue state
  List<Map<String, dynamic>> _queue = [];
  Map<String, dynamic> _counts = {};
  bool _queueLoading = true;

  // Battlefield state
  Map<String, dynamic>? _battlefield;
  bool _bfLoading = true;

  @override
  void initState() {
    super.initState();
    _tabController = TabController(length: 3, vsync: this);
    _loadQueue();
    _loadBattlefield();
  }

  @override
  void dispose() {
    _tabController.dispose();
    super.dispose();
  }

  Future<void> _loadQueue() async {
    setState(() => _queueLoading = true);
    try {
      final data = await _api.get('/api/v1/war-room/queue');
      setState(() {
        _queue = (data['queue'] as List? ?? []).cast<Map<String, dynamic>>();
        _counts = (data['counts'] as Map<String, dynamic>?) ?? {};
        _queueLoading = false;
      });
    } catch (e) {
      setState(() => _queueLoading = false);
    }
  }

  Future<void> _loadBattlefield() async {
    setState(() => _bfLoading = true);
    try {
      final data = await _api.get('/api/v1/war-room/battlefield');
      setState(() { _battlefield = data; _bfLoading = false; });
    } catch (e) {
      setState(() => _bfLoading = false);
    }
  }

  void _selectTask(Map<String, dynamic> task) {
    setState(() => _selectedTask = task);
    _tabController.animateTo(1);
  }

  Future<void> _takeAction(String taskId, Map<String, dynamic> body) async {
    try {
      await _api.post('/api/v1/tasks/$taskId/decisions', body);
      await _loadQueue();
      await _loadBattlefield();
    } catch (e) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text('Action failed: $e')));
      }
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        title: const Text('War Room'),
        backgroundColor: AppColors.midnight,
        foregroundColor: AppColors.white,
        bottom: TabBar(
          controller: _tabController,
          indicatorColor: AppColors.taskoraRed,
          labelColor: AppColors.white,
          unselectedLabelColor: AppColors.steel,
          tabs: const [
            Tab(text: 'Queue'),
            Tab(text: 'Focus'),
            Tab(text: 'Battlefield'),
          ],
        ),
      ),
      body: TabBarView(
        controller: _tabController,
        children: [
          _buildQueue(),
          _buildFocus(),
          _buildBattlefield(),
        ],
      ),
    );
  }

  Widget _buildQueue() {
    if (_queueLoading) return const Center(child: CircularProgressIndicator());
    return RefreshIndicator(
      onRefresh: _loadQueue,
      child: Column(
        children: [
          // Count pills
          Padding(
            padding: const EdgeInsets.fromLTRB(16, 12, 16, 4),
            child: Row(children: [
              _CountPill(label: 'Pending', count: _counts['pending'] ?? 0, color: AppColors.statusPendingText),
              const SizedBox(width: 8),
              _CountPill(label: 'Blocked', count: _counts['blocked'] ?? 0, color: AppColors.taskoraRed),
              const SizedBox(width: 8),
              _CountPill(label: 'Overdue', count: _counts['overdue'] ?? 0, color: AppColors.statusOverdueText),
            ]),
          ),
          Expanded(
            child: _queue.isEmpty
                ? const Center(child: Text('Queue is clear ✓', style: TextStyle(color: AppColors.steel, fontSize: 16)))
                : ListView.separated(
                    padding: const EdgeInsets.all(16),
                    itemCount: _queue.length,
                    separatorBuilder: (_, __) => const SizedBox(height: 12),
                    itemBuilder: (_, i) => _DecisionCard(task: _queue[i], onTap: _selectTask),
                  ),
          ),
        ],
      ),
    );
  }

  Widget _buildFocus() {
    if (_selectedTask == null) {
      return const Center(child: Column(
        mainAxisSize: MainAxisSize.min,
        children: [
          Icon(Icons.gps_not_fixed, size: 48, color: AppColors.steel),
          SizedBox(height: 12),
          Text('Select a task from the Queue', style: TextStyle(color: AppColors.steel, fontSize: 16)),
        ],
      ));
    }

    final task = _selectedTask!;
    final taskId = task['id'] as String;

    return SingleChildScrollView(
      padding: const EdgeInsets.all(20),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(task['title'] as String? ?? '', style: AppTextStyles.headlineMedium),
          const SizedBox(height: 4),
          if (task['age_label'] != null)
            Row(children: [
              const Icon(Icons.access_time, size: 14, color: AppColors.steel),
              const SizedBox(width: 4),
              Text(task['age_label'] as String, style: AppTextStyles.labelSmall),
            ]),
          const SizedBox(height: 24),
          Text('Decision Actions', style: AppTextStyles.titleMedium),
          const SizedBox(height: 12),
          _ActionButton(
            label: 'Approve',
            color: AppColors.statusDoneBg,
            textColor: AppColors.statusDoneText,
            onTap: () => _takeAction(taskId, {'action': 'approve'}),
          ),
          const SizedBox(height: 8),
          _ActionButton(
            label: 'Reject',
            color: AppColors.statusOverdueBg,
            textColor: AppColors.statusOverdueText,
            onTap: () => _showRejectSheet(taskId),
          ),
          const SizedBox(height: 8),
          _ActionButton(
            label: 'Request Info',
            color: AppColors.mist,
            textColor: AppColors.midnight,
            onTap: () => _takeAction(taskId, {'action': 'request_info'}),
          ),
          const SizedBox(height: 8),
          _ActionButton(
            label: 'Snooze',
            color: AppColors.mist,
            textColor: AppColors.steel,
            onTap: () => _showSnoozeSheet(taskId),
          ),
        ],
      ),
    );
  }

  void _showRejectSheet(String taskId) {
    final controller = TextEditingController();
    showModalBottomSheet(
      context: context,
      isScrollControlled: true,
      builder: (_) => Padding(
        padding: EdgeInsets.only(
          bottom: MediaQuery.of(context).viewInsets.bottom,
          left: 20, right: 20, top: 20,
        ),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            const Text('Reason for rejection', style: TextStyle(fontWeight: FontWeight.w600, fontSize: 16)),
            const SizedBox(height: 12),
            TextField(controller: controller, decoration: const InputDecoration(hintText: 'Enter reason...')),
            const SizedBox(height: 12),
            SizedBox(
              width: double.infinity,
              child: ElevatedButton(
                style: ElevatedButton.styleFrom(backgroundColor: AppColors.taskoraRed),
                onPressed: () {
                  Navigator.pop(context);
                  _takeAction(taskId, {'action': 'reject', 'reason': controller.text.trim()});
                },
                child: const Text('Confirm Reject', style: TextStyle(color: AppColors.white)),
              ),
            ),
            const SizedBox(height: 20),
          ],
        ),
      ),
    );
  }

  void _showSnoozeSheet(String taskId) {
    final options = {'1 hour': 1, '4 hours': 4, '24 hours': 24};
    showModalBottomSheet(
      context: context,
      builder: (_) => Column(
        mainAxisSize: MainAxisSize.min,
        children: [
          const ListTile(title: Text('Snooze for', style: TextStyle(fontWeight: FontWeight.w700))),
          ...options.entries.map((e) => ListTile(
            title: Text(e.key),
            onTap: () {
              Navigator.pop(context);
              _takeAction(taskId, {'action': 'snooze', 'snooze_hours': e.value});
            },
          )),
          const SizedBox(height: 12),
        ],
      ),
    );
  }

  Widget _buildBattlefield() {
    if (_bfLoading) return const Center(child: CircularProgressIndicator());
    final bf = _battlefield ?? {};
    return RefreshIndicator(
      onRefresh: _loadBattlefield,
      child: ListView(
        padding: const EdgeInsets.all(16),
        children: [
          _MetricCard(label: 'Pending Decisions', value: '${bf['pending_decisions'] ?? '—'}',
              color: AppColors.statusPendingBg, textColor: AppColors.statusPendingText),
          const SizedBox(height: 12),
          _MetricCard(label: 'Overdue Decisions', value: '${bf['overdue_decisions'] ?? '—'}',
              color: AppColors.statusOverdueBg, textColor: AppColors.statusOverdueText),
          const SizedBox(height: 12),
          _MetricCard(label: 'Blocked Tasks', value: '${bf['blocked_tasks'] ?? '—'}',
              color: AppColors.statusOverdueBg, textColor: AppColors.statusOverdueText),
          const SizedBox(height: 12),
          _MetricCard(label: 'Decisions Made Today', value: '${bf['decisions_today'] ?? '—'}',
              color: AppColors.statusDoneBg, textColor: AppColors.statusDoneText),
          const SizedBox(height: 12),
          _MetricCard(label: 'Stale Tasks', value: '${bf['stale_tasks'] ?? '—'}',
              color: AppColors.statusStaleBg, textColor: AppColors.statusStaleText),
        ],
      ),
    );
  }
}

class _CountPill extends StatelessWidget {
  final String label;
  final int count;
  final Color color;
  const _CountPill({required this.label, required this.count, required this.color});

  @override
  Widget build(BuildContext context) => Container(
    padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 5),
    decoration: BoxDecoration(color: AppColors.mist, borderRadius: BorderRadius.circular(20)),
    child: Row(mainAxisSize: MainAxisSize.min, children: [
      Text(label, style: AppTextStyles.labelSmall.copyWith(color: AppColors.steel)),
      const SizedBox(width: 6),
      Container(
        padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 1),
        decoration: BoxDecoration(color: color, borderRadius: BorderRadius.circular(10)),
        child: Text('$count', style: const TextStyle(color: AppColors.white, fontSize: 11, fontWeight: FontWeight.w700)),
      ),
    ]),
  );
}

class _DecisionCard extends StatelessWidget {
  final Map<String, dynamic> task;
  final void Function(Map<String, dynamic>) onTap;
  const _DecisionCard({required this.task, required this.onTap});

  Color _priorityColor() {
    switch (task['priority']) {
      case 'urgent':
      case 'critical': return AppColors.taskoraRed;
      case 'high': return const Color(0xFFF59E0B);
      default: return AppColors.ocean;
    }
  }

  @override
  Widget build(BuildContext context) {
    final entities = (task['task_entities'] as List?)?.cast<Map<String, dynamic>>() ?? [];
    final entityNames = entities
        .map((e) => e['entity_name'] as String? ?? e['entity_id'] as String? ?? '')
        .take(3)
        .toList();

    return GestureDetector(
      onTap: () => onTap(task),
      child: Container(
        decoration: BoxDecoration(
          color: AppColors.white,
          border: Border(
            left: BorderSide(color: _priorityColor(), width: 3),
            top: const BorderSide(color: AppColors.pebble),
            right: const BorderSide(color: AppColors.pebble),
            bottom: const BorderSide(color: AppColors.pebble),
          ),
          borderRadius: BorderRadius.circular(8),
          boxShadow: const [BoxShadow(color: Color(0x14000000), blurRadius: 3, offset: Offset(0, 1))],
        ),
        padding: const EdgeInsets.all(14),
        child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
          Row(children: [
            Expanded(child: Text(task['title'] as String? ?? '', style: AppTextStyles.titleMedium)),
            Container(
              padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 2),
              decoration: BoxDecoration(
                color: _priorityColor().withOpacity(0.12),
                borderRadius: BorderRadius.circular(8),
              ),
              child: Text(
                (task['priority'] as String? ?? '').toUpperCase(),
                style: TextStyle(fontSize: 10, fontWeight: FontWeight.w700, color: _priorityColor()),
              ),
            ),
          ]),
          const SizedBox(height: 6),
          Row(children: [
            const Icon(Icons.access_time, size: 12, color: AppColors.steel),
            const SizedBox(width: 4),
            Text(task['age_label'] as String? ?? '—', style: AppTextStyles.labelSmall),
            if (entityNames.isNotEmpty) ...[
              const SizedBox(width: 10),
              ...entityNames.map((e) => Padding(
                padding: const EdgeInsets.only(right: 4),
                child: Container(
                  padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 2),
                  decoration: BoxDecoration(color: AppColors.mist, borderRadius: BorderRadius.circular(4)),
                  child: Text(e, style: AppTextStyles.labelSmall),
                ),
              )),
            ],
          ]),
        ]),
      ),
    );
  }
}

class _ActionButton extends StatelessWidget {
  final String label;
  final Color color;
  final Color textColor;
  final VoidCallback onTap;
  const _ActionButton({required this.label, required this.color, required this.textColor, required this.onTap});

  @override
  Widget build(BuildContext context) => SizedBox(
    width: double.infinity,
    height: 48,
    child: ElevatedButton(
      onPressed: onTap,
      style: ElevatedButton.styleFrom(
        backgroundColor: color,
        foregroundColor: textColor,
        elevation: 0,
        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(8)),
      ),
      child: Text(label, style: TextStyle(color: textColor, fontWeight: FontWeight.w600, fontSize: 15)),
    ),
  );
}

class _MetricCard extends StatelessWidget {
  final String label;
  final String value;
  final Color color;
  final Color textColor;
  const _MetricCard({required this.label, required this.value, required this.color, required this.textColor});

  @override
  Widget build(BuildContext context) => Container(
    padding: const EdgeInsets.all(20),
    decoration: BoxDecoration(color: color, borderRadius: BorderRadius.circular(12)),
    child: Row(
      mainAxisAlignment: MainAxisAlignment.spaceBetween,
      children: [
        Text(label, style: TextStyle(color: textColor, fontWeight: FontWeight.w500, fontSize: 15)),
        Text(value, style: TextStyle(color: textColor, fontWeight: FontWeight.w700, fontSize: 28)),
      ],
    ),
  );
}
