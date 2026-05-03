import 'package:flutter/material.dart';
import '../theme/app_colors.dart';
import '../theme/app_text_styles.dart';
import '../services/api_service.dart';

class ReportsScreen extends StatefulWidget {
  const ReportsScreen({super.key});
  @override
  State<ReportsScreen> createState() => _ReportsScreenState();
}

class _ReportsScreenState extends State<ReportsScreen> with SingleTickerProviderStateMixin {
  final _api = ApiService();
  late final TabController _tabController;
  String _businessId = '';
  bool _loading = false;
  String? _error;
  List<Map<String, dynamic>> _taskRows = [];
  List<Map<String, dynamic>> _initRows = [];
  DateTime _startDate = DateTime.now().subtract(const Duration(days: 30));
  DateTime _endDate = DateTime.now();

  @override
  void initState() {
    super.initState();
    _tabController = TabController(length: 2, vsync: this);
    _loadBusiness();
  }

  @override
  void dispose() {
    _tabController.dispose();
    super.dispose();
  }

  Future<void> _loadBusiness() async {
    try {
      final businesses = await _api.getList('/api/v1/businesses/my');
      if (businesses.isNotEmpty && mounted) {
        setState(() => _businessId = businesses[0]['id'] ?? '');
      }
    } catch (_) {}
  }

  String _fmtDate(DateTime d) => '${d.year}-${d.month.toString().padLeft(2,'0')}-${d.day.toString().padLeft(2,'0')}';

  Future<void> _generate() async {
    if (_businessId.isEmpty) return;
    setState(() { _loading = true; _error = null; });
    try {
      final start = _fmtDate(_startDate);
      final end = _fmtDate(_endDate);
      if (_tabController.index == 0) {
        final rows = await _api.getList('/api/v1/reports/tasks?business_id=$_businessId&start_date=$start&end_date=$end&format=json');
        setState(() { _taskRows = rows; _loading = false; });
      } else {
        final rows = await _api.getList('/api/v1/reports/initiatives?business_id=$_businessId&start_date=$start&end_date=$end&format=json');
        setState(() { _initRows = rows; _loading = false; });
      }
    } catch (e) {
      setState(() { _error = e.toString(); _loading = false; });
    }
  }

  Future<void> _pickDate({required bool isStart}) async {
    final picked = await showDatePicker(
      context: context,
      initialDate: isStart ? _startDate : _endDate,
      firstDate: DateTime(2020),
      lastDate: DateTime.now(),
    );
    if (picked != null && mounted) {
      setState(() {
        if (isStart) _startDate = picked;
        else _endDate = picked;
      });
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        title: const Text('Reports'),
        backgroundColor: AppColors.midnight,
        foregroundColor: AppColors.white,
        actions: [IconButton(icon: const Icon(Icons.refresh), onPressed: _generate)],
        bottom: TabBar(
          controller: _tabController,
          indicatorColor: AppColors.taskoraRed,
          labelColor: AppColors.white,
          unselectedLabelColor: AppColors.steel,
          tabs: const [Tab(text: 'Tasks'), Tab(text: 'Initiatives')],
        ),
      ),
      body: Column(children: [
        // Date range picker
        Container(
          padding: const EdgeInsets.all(16),
          color: AppColors.white,
          child: Row(children: [
            Expanded(child: _DateButton(
              label: 'From',
              date: _startDate,
              onTap: () => _pickDate(isStart: true),
            )),
            const SizedBox(width: 12),
            Expanded(child: _DateButton(
              label: 'To',
              date: _endDate,
              onTap: () => _pickDate(isStart: false),
            )),
            const SizedBox(width: 12),
            ElevatedButton(
              onPressed: _loading ? null : _generate,
              style: ElevatedButton.styleFrom(
                backgroundColor: AppColors.midnight,
                foregroundColor: AppColors.white,
                padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 12),
              ),
              child: _loading
                  ? const SizedBox(width: 16, height: 16, child: CircularProgressIndicator(strokeWidth: 2, color: Colors.white))
                  : const Text('Go', style: TextStyle(fontSize: 13)),
            ),
          ]),
        ),

        if (_error != null)
          Container(
            margin: const EdgeInsets.all(16),
            padding: const EdgeInsets.all(12),
            decoration: BoxDecoration(color: const Color(0xFFFEE2E2), borderRadius: BorderRadius.circular(8)),
            child: Text(_error!, style: const TextStyle(color: Color(0xFFB91C1C), fontSize: 13)),
          ),

        Expanded(
          child: TabBarView(controller: _tabController, children: [
            _buildTasksTab(),
            _buildInitiativesTab(),
          ]),
        ),
      ]),
    );
  }

  Widget _buildTasksTab() {
    if (_taskRows.isEmpty) {
      return const Center(child: Text('Select dates and tap Go to generate', style: TextStyle(color: AppColors.steel)));
    }
    final total = _taskRows.fold<int>(0, (s, r) => s + (r['tasks_owned'] as int? ?? 0));
    final done = _taskRows.fold<int>(0, (s, r) => s + (r['tasks_completed'] as int? ?? 0));
    final pct = total > 0 ? (done / total * 100).toStringAsFixed(0) : '0';
    return ListView(
      padding: const EdgeInsets.all(16),
      children: [
        // Summary row
        Row(children: [
          Expanded(child: _SummaryCard(label: 'Total Tasks', value: '$total')),
          const SizedBox(width: 8),
          Expanded(child: _SummaryCard(label: 'Completion', value: '$pct%', green: true)),
        ]),
        const SizedBox(height: 16),
        ..._taskRows.map((r) => _TaskReportCard(row: r)),
      ],
    );
  }

  Widget _buildInitiativesTab() {
    if (_initRows.isEmpty) {
      return const Center(child: Text('Select dates and tap Go to generate', style: TextStyle(color: AppColors.steel)));
    }
    return ListView.builder(
      padding: const EdgeInsets.all(16),
      itemCount: _initRows.length,
      itemBuilder: (_, i) => _InitReportCard(row: _initRows[i]),
    );
  }
}

class _DateButton extends StatelessWidget {
  final String label;
  final DateTime date;
  final VoidCallback onTap;
  const _DateButton({required this.label, required this.date, required this.onTap});
  String _fmt(DateTime d) => '${d.day}/${d.month}/${d.year}';
  @override
  Widget build(BuildContext context) => GestureDetector(
    onTap: onTap,
    child: Container(
      padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 8),
      decoration: BoxDecoration(
        border: Border.all(color: AppColors.pebble),
        borderRadius: BorderRadius.circular(8),
      ),
      child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
        Text(label, style: const TextStyle(fontSize: 10, color: AppColors.steel)),
        Text(_fmt(date), style: const TextStyle(fontSize: 13, fontWeight: FontWeight.w600, color: AppColors.midnight)),
      ]),
    ),
  );
}

class _SummaryCard extends StatelessWidget {
  final String label;
  final String value;
  final bool green;
  const _SummaryCard({required this.label, required this.value, this.green = false});
  @override
  Widget build(BuildContext context) => Container(
    padding: const EdgeInsets.all(14),
    decoration: BoxDecoration(
      color: green ? const Color(0xFFD1FAE5) : AppColors.white,
      borderRadius: BorderRadius.circular(8),
      border: Border.all(color: green ? const Color(0xFF6EE7B7) : AppColors.pebble),
    ),
    child: Column(children: [
      Text(value, style: TextStyle(fontSize: 22, fontWeight: FontWeight.w700, color: green ? const Color(0xFF065F46) : AppColors.midnight)),
      const SizedBox(height: 2),
      Text(label, style: const TextStyle(fontSize: 11, color: AppColors.steel), textAlign: TextAlign.center),
    ]),
  );
}

class _TaskReportCard extends StatelessWidget {
  final Map<String, dynamic> row;
  const _TaskReportCard({required this.row});
  @override
  Widget build(BuildContext context) => Container(
    margin: const EdgeInsets.only(bottom: 8),
    padding: const EdgeInsets.all(14),
    decoration: BoxDecoration(
      color: AppColors.white,
      borderRadius: BorderRadius.circular(8),
      border: Border.all(color: AppColors.pebble),
    ),
    child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
      Text(row['user_name'] as String? ?? '—', style: AppTextStyles.titleMedium),
      const SizedBox(height: 8),
      Wrap(spacing: 12, runSpacing: 4, children: [
        _Stat(label: 'Owned', value: '${row['tasks_owned'] ?? 0}'),
        _Stat(label: 'Done', value: '${row['tasks_completed'] ?? 0}', color: const Color(0xFF065F46)),
        _Stat(label: 'Overdue', value: '${row['tasks_overdue'] ?? 0}', color: AppColors.taskoraRed),
        _Stat(label: 'Blocked', value: '${row['tasks_blocked'] ?? 0}', color: const Color(0xFFD97706)),
      ]),
    ]),
  );
}

class _Stat extends StatelessWidget {
  final String label;
  final String value;
  final Color? color;
  const _Stat({required this.label, required this.value, this.color});
  @override
  Widget build(BuildContext context) => Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
    Text(value, style: TextStyle(fontSize: 16, fontWeight: FontWeight.w700, color: color ?? AppColors.midnight)),
    Text(label, style: const TextStyle(fontSize: 10, color: AppColors.steel)),
  ]);
}

class _InitReportCard extends StatelessWidget {
  final Map<String, dynamic> row;
  const _InitReportCard({required this.row});
  @override
  Widget build(BuildContext context) {
    final pct = ((row['completion_pct'] as num? ?? 0) / 100).clamp(0.0, 1.0);
    return Container(
      margin: const EdgeInsets.only(bottom: 8),
      padding: const EdgeInsets.all(14),
      decoration: BoxDecoration(color: AppColors.white, borderRadius: BorderRadius.circular(8), border: Border.all(color: AppColors.pebble)),
      child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
        Text(row['initiative_title'] as String? ?? '—', style: AppTextStyles.titleMedium),
        const SizedBox(height: 8),
        ClipRRect(
          borderRadius: BorderRadius.circular(4),
          child: LinearProgressIndicator(value: pct, minHeight: 6, backgroundColor: AppColors.pebble, valueColor: const AlwaysStoppedAnimation(Color(0xFF10B981))),
        ),
        const SizedBox(height: 8),
        Row(mainAxisAlignment: MainAxisAlignment.spaceBetween, children: [
          Text('${(pct * 100).toStringAsFixed(0)}% done', style: AppTextStyles.labelSmall),
          if ((row['overdue_count'] as int? ?? 0) > 0)
            Text('${row['overdue_count']} overdue', style: const TextStyle(fontSize: 11, color: AppColors.taskoraRed)),
        ]),
      ]),
    );
  }
}
