import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';
import 'package:supabase_flutter/supabase_flutter.dart';
import '../theme/app_colors.dart';
import '../theme/app_text_styles.dart';
import '../services/api_service.dart';

const _statuses = ['All', 'Pending Decision', 'In Progress', 'Blocked', 'Done', 'To Do'];
const _sortOptions = ['Newest', 'Oldest', 'Due date', 'Priority'];

class MyTasksScreen extends StatefulWidget {
  const MyTasksScreen({super.key});

  @override
  State<MyTasksScreen> createState() => _MyTasksScreenState();
}

class _MyTasksScreenState extends State<MyTasksScreen> {
  final _api = ApiService();
  String _selectedStatus = 'All';
  String _selectedSort = 'Newest';
  bool _searchVisible = false;
  String _searchQuery = '';
  List<Map<String, dynamic>> _tasks = [];
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
      final data = await _api.getList('/api/v1/tasks/my');
      setState(() {
        _tasks = data.cast<Map<String, dynamic>>();
        _loading = false;
      });
    } catch (e) {
      setState(() { _error = e.toString(); _loading = false; });
    }
  }

  String _statusLabel(String s) {
    switch (s) {
      case 'pending_decision': return 'Pending Decision';
      case 'in_progress': return 'In Progress';
      case 'blocked': return 'Blocked';
      case 'done': return 'Done';
      case 'todo': return 'To Do';
      default: return s.replaceAll('_', ' ');
    }
  }

  List<Map<String, dynamic>> get _filtered {
    var list = _tasks.where((t) {
      final statusOk = _selectedStatus == 'All' ||
          _statusLabel(t['status'] as String? ?? '') == _selectedStatus;
      final searchOk = _searchQuery.isEmpty ||
          (t['title'] as String? ?? '').toLowerCase().contains(_searchQuery.toLowerCase());
      return statusOk && searchOk;
    }).toList();

    switch (_selectedSort) {
      case 'Oldest':
        list.sort((a, b) => (a['created_at'] as String? ?? '').compareTo(b['created_at'] as String? ?? ''));
        break;
      case 'Due date':
        list.sort((a, b) => (a['due_date'] as String? ?? '9999').compareTo(b['due_date'] as String? ?? '9999'));
        break;
      case 'Priority':
        const order = {'urgent': 0, 'critical': 0, 'high': 1, 'medium': 2, 'low': 3};
        list.sort((a, b) => (order[a['priority']] ?? 2).compareTo(order[b['priority']] ?? 2));
        break;
      default:
        list.sort((a, b) => (b['created_at'] as String? ?? '').compareTo(a['created_at'] as String? ?? ''));
    }
    return list;
  }

  void _showCreateSheet() {
    final titleCtrl = TextEditingController();
    showModalBottomSheet(
      context: context,
      isScrollControlled: true,
      shape: const RoundedRectangleBorder(borderRadius: BorderRadius.vertical(top: Radius.circular(16))),
      builder: (ctx) => Padding(
        padding: EdgeInsets.only(
          left: 20, right: 20, top: 20,
          bottom: MediaQuery.of(ctx).viewInsets.bottom + 20,
        ),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text('New Task', style: AppTextStyles.titleMedium),
            const SizedBox(height: 12),
            TextField(
              controller: titleCtrl,
              autofocus: true,
              decoration: InputDecoration(
                hintText: 'Task title...',
                filled: true,
                fillColor: AppColors.mist,
                border: OutlineInputBorder(
                  borderRadius: BorderRadius.circular(8),
                  borderSide: BorderSide.none,
                ),
              ),
            ),
            const SizedBox(height: 16),
            SizedBox(
              width: double.infinity,
              child: ElevatedButton(
                style: ElevatedButton.styleFrom(
                  backgroundColor: AppColors.taskoraRed,
                  shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(8)),
                  padding: const EdgeInsets.symmetric(vertical: 14),
                ),
                onPressed: () async {
                  final title = titleCtrl.text.trim();
                  if (title.isEmpty) return;
                  Navigator.pop(ctx);
                  final userId = Supabase.instance.client.auth.currentUser?.id ?? '';
                  try {
                    await _api.post('/api/v1/tasks/', {
                      'title': title,
                      'status': 'todo',
                      'priority': 'medium',
                      'primary_stakeholder_id': userId,
                    });
                    _load();
                  } catch (e) {
                    if (mounted) {
                      ScaffoldMessenger.of(context).showSnackBar(
                        SnackBar(content: Text('Failed to create task: $e')),
                      );
                    }
                  }
                },
                child: const Text('Create Task',
                    style: TextStyle(color: AppColors.white, fontWeight: FontWeight.w600)),
              ),
            ),
          ],
        ),
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        title: const Text('My Tasks'),
        actions: [
          IconButton(
            icon: Icon(_searchVisible ? Icons.search_off : Icons.search),
            onPressed: () => setState(() {
              _searchVisible = !_searchVisible;
              if (!_searchVisible) _searchQuery = '';
            }),
          ),
          PopupMenuButton<String>(
            icon: const Icon(Icons.sort),
            onSelected: (v) => setState(() => _selectedSort = v),
            itemBuilder: (_) =>
                _sortOptions.map((o) => PopupMenuItem(value: o, child: Text(o))).toList(),
          ),
        ],
      ),
      body: _loading
          ? const Center(child: CircularProgressIndicator())
          : _error != null
              ? Center(
                  child: Column(
                    mainAxisSize: MainAxisSize.min,
                    children: [
                      Text('Failed to load tasks', style: AppTextStyles.bodyMedium),
                      const SizedBox(height: 8),
                      ElevatedButton(onPressed: _load, child: const Text('Retry')),
                    ],
                  ),
                )
              : RefreshIndicator(
                  onRefresh: _load,
                  child: Column(
                    children: [
                      if (_searchVisible)
                        Padding(
                          padding: const EdgeInsets.fromLTRB(16, 8, 16, 0),
                          child: TextField(
                            autofocus: true,
                            decoration: InputDecoration(
                              hintText: 'Search tasks...',
                              prefixIcon: const Icon(Icons.search, color: AppColors.steel),
                              filled: true,
                              fillColor: AppColors.mist,
                              border: OutlineInputBorder(
                                borderRadius: BorderRadius.circular(12),
                                borderSide: BorderSide.none,
                              ),
                            ),
                            onChanged: (v) => setState(() => _searchQuery = v),
                          ),
                        ),
                      SizedBox(
                        height: 44,
                        child: ListView.separated(
                          scrollDirection: Axis.horizontal,
                          padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 6),
                          itemCount: _statuses.length,
                          separatorBuilder: (_, __) => const SizedBox(width: 8),
                          itemBuilder: (_, i) {
                            final s = _statuses[i];
                            final active = s == _selectedStatus;
                            return GestureDetector(
                              onTap: () => setState(() => _selectedStatus = s),
                              child: Container(
                                padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 4),
                                decoration: BoxDecoration(
                                  color: active ? AppColors.taskoraRed : AppColors.mist,
                                  borderRadius: BorderRadius.circular(20),
                                ),
                                alignment: Alignment.center,
                                child: Text(s,
                                    style: AppTextStyles.labelSmall.copyWith(
                                      color: active ? AppColors.white : AppColors.steel,
                                      fontWeight: active ? FontWeight.w600 : FontWeight.w500,
                                    )),
                              ),
                            );
                          },
                        ),
                      ),
                      Expanded(
                        child: _filtered.isEmpty
                            ? Center(
                                child: Column(
                                  mainAxisSize: MainAxisSize.min,
                                  children: [
                                    const Text('No tasks match your filters',
                                        style: TextStyle(color: AppColors.steel)),
                                    TextButton(
                                      onPressed: () => setState(() {
                                        _selectedStatus = 'All';
                                        _searchQuery = '';
                                      }),
                                      child: const Text('Clear filters'),
                                    ),
                                  ],
                                ),
                              )
                            : ListView.separated(
                                padding: const EdgeInsets.all(16),
                                itemCount: _filtered.length,
                                separatorBuilder: (_, __) => const SizedBox(height: 10),
                                itemBuilder: (_, i) => _TaskCard(task: _filtered[i]),
                              ),
                      ),
                    ],
                  ),
                ),
      floatingActionButton: FloatingActionButton(
        backgroundColor: AppColors.taskoraRed,
        onPressed: _showCreateSheet,
        child: const Icon(Icons.add, color: AppColors.white),
      ),
    );
  }
}

class _TaskCard extends StatelessWidget {
  final Map<String, dynamic> task;
  const _TaskCard({required this.task});

  Color _leftBorder() {
    switch (task['priority']) {
      case 'urgent':
      case 'critical': return AppColors.taskoraRed;
      case 'high': return const Color(0xFFF59E0B);
      default: return AppColors.ocean;
    }
  }

  Color _statusBg() {
    switch (task['status']) {
      case 'pending_decision': return AppColors.statusPendingBg;
      case 'in_progress': return AppColors.statusInProgressBg;
      case 'blocked': return AppColors.statusOverdueBg;
      case 'done': return AppColors.statusDoneBg;
      default: return AppColors.mist;
    }
  }

  Color _statusText() {
    switch (task['status']) {
      case 'pending_decision': return AppColors.statusPendingText;
      case 'in_progress': return AppColors.statusInProgressText;
      case 'blocked': return AppColors.statusOverdueText;
      case 'done': return AppColors.statusDoneText;
      default: return AppColors.steel;
    }
  }

  String _statusLabel() {
    switch (task['status']) {
      case 'pending_decision': return 'Pending Decision';
      case 'in_progress': return 'In Progress';
      case 'blocked': return 'Blocked';
      case 'done': return 'Done';
      case 'todo': return 'To Do';
      default: return (task['status'] as String? ?? '').replaceAll('_', ' ');
    }
  }

  @override
  Widget build(BuildContext context) {
    final rawEntities = (task['task_entities'] as List?)?.cast<Map<String, dynamic>>() ?? [];
    final entityNames = rawEntities
        .map((e) => e['entity_name'] as String? ?? e['entity_id'] as String? ?? '')
        .toList();
    final isStale = task['is_stale'] == true;

    return GestureDetector(
      onTap: () => context.push('/tasks/${task['id']}'),
      child: Container(
        decoration: BoxDecoration(
          color: AppColors.white,
          border: Border(
            left: BorderSide(color: _leftBorder(), width: 3),
            top: const BorderSide(color: AppColors.pebble),
            right: const BorderSide(color: AppColors.pebble),
            bottom: const BorderSide(color: AppColors.pebble),
          ),
          borderRadius: BorderRadius.circular(8),
          boxShadow: const [BoxShadow(color: Color(0x14000000), blurRadius: 3, offset: Offset(0, 1))],
        ),
        padding: const EdgeInsets.all(14),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(children: [
              Expanded(child: Text(task['title'] as String? ?? '', style: AppTextStyles.titleMedium)),
              if (isStale)
                Container(
                  padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 2),
                  decoration: BoxDecoration(color: AppColors.statusStaleBg, borderRadius: BorderRadius.circular(8)),
                  child: const Text('Needs Update',
                      style: TextStyle(fontSize: 10, color: AppColors.statusStaleText, fontWeight: FontWeight.w600)),
                ),
            ]),
            const SizedBox(height: 6),
            Row(children: [
              Container(
                padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 2),
                decoration: BoxDecoration(color: _statusBg(), borderRadius: BorderRadius.circular(12)),
                child: Text(_statusLabel(),
                    style: TextStyle(fontSize: 11, color: _statusText(), fontWeight: FontWeight.w500)),
              ),
              const SizedBox(width: 8),
              if (task['due_date'] != null) ...[
                const Icon(Icons.calendar_today, size: 11, color: AppColors.steel),
                const SizedBox(width: 3),
                Text(task['due_date'] as String, style: AppTextStyles.labelSmall),
              ],
            ]),
            if (entityNames.isNotEmpty) ...[
              const SizedBox(height: 6),
              Wrap(
                spacing: 4,
                children: entityNames.map((e) => Container(
                  padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 2),
                  decoration: BoxDecoration(color: AppColors.mist, borderRadius: BorderRadius.circular(4)),
                  child: Text(e, style: const TextStyle(fontSize: 11, color: AppColors.steel)),
                )).toList(),
              ),
            ],
          ],
        ),
      ),
    );
  }
}
