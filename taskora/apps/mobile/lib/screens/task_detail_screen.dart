import 'package:flutter/material.dart';
import '../theme/app_colors.dart';
import '../theme/app_text_styles.dart';
import '../services/api_service.dart';

const _statusOptions = ['backlog', 'todo', 'in_progress', 'pending_decision', 'blocked', 'done', 'archived'];

class TaskDetailScreen extends StatefulWidget {
  final String taskId;
  const TaskDetailScreen({super.key, required this.taskId});

  @override
  State<TaskDetailScreen> createState() => _TaskDetailScreenState();
}

class _TaskDetailScreenState extends State<TaskDetailScreen> {
  final _api = ApiService();
  Map<String, dynamic>? _task;
  bool _loading = true;
  String? _error;
  bool _editingTitle = false;
  final _titleController = TextEditingController();
  final _commentController = TextEditingController();
  bool _savingComment = false;
  Map<String, dynamic>? _dependencies;
  List<Map<String, dynamic>> _activityLog = [];

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    setState(() { _loading = true; _error = null; });
    try {
      final data = await _api.get('/api/v1/tasks/${widget.taskId}');
      setState(() {
        _task = data;
        _titleController.text = data['title'] as String? ?? '';
        _loading = false;
      });
      // Load dependencies and activity in background
      _loadDependencies();
      _loadActivity();
    } catch (e) {
      setState(() { _error = e.toString(); _loading = false; });
    }
  }

  Future<void> _loadDependencies() async {
    try {
      final data = await _api.get('/api/v1/tasks/${widget.taskId}/dependencies');
      if (mounted) setState(() => _dependencies = data);
    } catch (_) {}
  }

  Future<void> _loadActivity() async {
    try {
      final rows = await _api.getList('/api/v1/activity/?task_id=${widget.taskId}&limit=20');
      if (mounted) setState(() => _activityLog = rows);
    } catch (_) {}
  }

  Future<void> _markMeetingHeld() async {
    try {
      await _api.post('/api/v1/tasks/${widget.taskId}/recurring/mark-done', {});
      if (mounted) ScaffoldMessenger.of(context).showSnackBar(const SnackBar(content: Text('Meeting marked held — next date calculated ✓')));
      _load();
    } catch (e) {
      if (mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text('Failed: $e')));
    }
  }

  Future<void> _editFollowUpDate() async {
    final picked = await showDatePicker(
      context: context,
      initialDate: DateTime.now().add(const Duration(days: 1)),
      firstDate: DateTime.now(),
      lastDate: DateTime.now().add(const Duration(days: 365)),
    );
    if (picked != null && mounted) {
      final dateStr = '${picked.year}-${picked.month.toString().padLeft(2,'0')}-${picked.day.toString().padLeft(2,'0')}';
      try {
        await _api.patch('/api/v1/tasks/${widget.taskId}', {'follow_up_date': dateStr});
        _load();
      } catch (e) {
        if (mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text('Failed: $e')));
      }
    }
  }

  String _fmtDate(String? iso) {
    if (iso == null) return '—';
    try {
      final d = DateTime.parse(iso);
      return '${d.day}/${d.month}/${d.year}';
    } catch (_) { return iso; }
  }

  Future<void> _patchStatus(String newStatus) async {
    try {
      await _api.patch('/api/v1/tasks/${widget.taskId}', {'status': newStatus});
      await _load();
    } catch (e) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text('Failed: $e')));
      }
    }
  }

  Future<void> _saveTitle() async {
    final newTitle = _titleController.text.trim();
    setState(() => _editingTitle = false);
    if (newTitle.isEmpty || newTitle == _task?['title']) return;
    try {
      await _api.patch('/api/v1/tasks/${widget.taskId}', {'title': newTitle});
      await _load();
    } catch (e) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text('Failed: $e')));
      }
    }
  }

  Future<void> _postComment() async {
    final content = _commentController.text.trim();
    if (content.isEmpty) return;
    setState(() => _savingComment = true);
    try {
      await _api.post('/api/v1/tasks/${widget.taskId}/comments', {'content': content});
      _commentController.clear();
      await _load();
    } catch (e) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text('Failed: $e')));
      }
    } finally {
      if (mounted) setState(() => _savingComment = false);
    }
  }

  void _showStatusPicker() {
    showModalBottomSheet(
      context: context,
      builder: (_) => Column(
        mainAxisSize: MainAxisSize.min,
        children: [
          Padding(padding: const EdgeInsets.all(16), child: Text('Change Status', style: AppTextStyles.titleMedium)),
          ..._statusOptions.map((s) => ListTile(
            title: Text(_statusLabel(s)),
            leading: CircleAvatar(radius: 6, backgroundColor: _statusColor(s)),
            onTap: () async { Navigator.pop(context); await _patchStatus(s); },
          )),
          const SizedBox(height: 12),
        ],
      ),
    );
  }

  String _statusLabel(String s) {
    switch (s) {
      case 'pending_decision': return 'Pending Decision';
      case 'in_progress': return 'In Progress';
      default: return s[0].toUpperCase() + s.substring(1);
    }
  }

  Color _statusColor(String s) {
    switch (s) {
      case 'pending_decision': return AppColors.statusPendingText;
      case 'in_progress': return AppColors.statusInProgressText;
      case 'blocked': return AppColors.taskoraRed;
      case 'done': return AppColors.statusDoneText;
      default: return AppColors.steel;
    }
  }

  Color _statusBg(String s) {
    switch (s) {
      case 'pending_decision': return AppColors.statusPendingBg;
      case 'in_progress': return AppColors.statusInProgressBg;
      case 'blocked': return AppColors.statusOverdueBg;
      case 'done': return AppColors.statusDoneBg;
      default: return AppColors.mist;
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('Task Detail')),
      body: _loading
          ? const Center(child: CircularProgressIndicator())
          : _error != null
              ? Center(child: Column(mainAxisSize: MainAxisSize.min, children: [
                  Text('Error loading task', style: AppTextStyles.bodyMedium),
                  const SizedBox(height: 8),
                  ElevatedButton(onPressed: _load, child: const Text('Retry')),
                ]))
              : _buildBody(),
    );
  }

  Widget _buildBody() {
    final task = _task!;
    final status = task['status'] as String? ?? 'backlog';
    final priority = task['priority'] as String? ?? 'medium';
    final entities = (task['task_entities'] as List?)?.cast<Map<String, dynamic>>() ?? [];
    final subtasks = (task['subtasks'] as List?)?.cast<Map<String, dynamic>>() ?? [];
    final comments = (task['comments'] as List?)?.cast<Map<String, dynamic>>() ?? [];
    final attachments = (task['attachments'] as List?)?.cast<Map<String, dynamic>>() ?? [];
    final stakeholders = (task['task_stakeholders'] as List?)?.cast<Map<String, dynamic>>() ?? [];

    return ListView(
      padding: const EdgeInsets.all(16),
      children: [
        // Title
        GestureDetector(
          onTap: () => setState(() => _editingTitle = true),
          child: _editingTitle
              ? TextField(
                  controller: _titleController,
                  style: AppTextStyles.headlineMedium,
                  autofocus: true,
                  onSubmitted: (_) => _saveTitle(),
                  onEditingComplete: _saveTitle,
                )
              : Text(task['title'] as String? ?? '', style: AppTextStyles.headlineMedium),
        ),
        const SizedBox(height: 12),

        // Status + priority row
        Row(children: [
          GestureDetector(
            onTap: _showStatusPicker,
            child: Container(
              padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 4),
              decoration: BoxDecoration(color: _statusBg(status), borderRadius: BorderRadius.circular(12)),
              child: Text(_statusLabel(status),
                  style: TextStyle(fontSize: 12, color: _statusColor(status), fontWeight: FontWeight.w600)),
            ),
          ),
          const SizedBox(width: 8),
          Container(
            padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 4),
            decoration: BoxDecoration(color: AppColors.mist, borderRadius: BorderRadius.circular(12)),
            child: Text(priority.toUpperCase(),
                style: const TextStyle(fontSize: 11, color: AppColors.steel, fontWeight: FontWeight.w600)),
          ),
        ]),

        // Due date
        if (task['due_date'] != null) ...[
          const SizedBox(height: 12),
          Row(children: [
            const Icon(Icons.calendar_today, size: 14, color: AppColors.steel),
            const SizedBox(width: 6),
            Text('Due: ${task['due_date']}', style: AppTextStyles.bodyMedium),
          ]),
        ],

        // Follow-up date
        if (task['follow_up_date'] != null) ...[
          const SizedBox(height: 8),
          Row(children: [
            const Icon(Icons.push_pin, size: 14, color: AppColors.ocean),
            const SizedBox(width: 6),
            Text('Follow-up: ${task['follow_up_date']}', style: AppTextStyles.bodyMedium),
            const Spacer(),
            TextButton(
              onPressed: _editFollowUpDate,
              child: const Text('Edit', style: TextStyle(fontSize: 12)),
            ),
          ]),
        ] else ...[
          const SizedBox(height: 4),
          TextButton.icon(
            onPressed: _editFollowUpDate,
            icon: const Icon(Icons.push_pin_outlined, size: 14),
            label: const Text('Add Follow-up Date', style: TextStyle(fontSize: 12)),
            style: TextButton.styleFrom(foregroundColor: AppColors.steel),
          ),
        ],

        // Recurring meeting section
        if (task['recurring_type'] != null && task['recurring_type'] != 'none') ...[
          const SizedBox(height: 12),
          Container(
            padding: const EdgeInsets.all(12),
            decoration: BoxDecoration(
              color: const Color(0xFFEFF6FF),
              borderRadius: BorderRadius.circular(8),
              border: Border.all(color: const Color(0xFFBFDBFE)),
            ),
            child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
              Row(children: [
                const Icon(Icons.repeat, size: 14, color: AppColors.ocean),
                const SizedBox(width: 6),
                Text('Recurring: ${task['recurring_type']}',
                    style: const TextStyle(fontSize: 13, fontWeight: FontWeight.w600, color: AppColors.ocean)),
                const Spacer(),
                if (task['next_meeting_at'] != null)
                  Text('Next: ${_fmtDate(task['next_meeting_at'] as String?)}',
                      style: AppTextStyles.labelSmall),
              ]),
              const SizedBox(height: 8),
              SizedBox(
                width: double.infinity,
                child: ElevatedButton(
                  onPressed: _markMeetingHeld,
                  style: ElevatedButton.styleFrom(
                    backgroundColor: AppColors.ocean,
                    foregroundColor: Colors.white,
                    padding: const EdgeInsets.symmetric(vertical: 10),
                  ),
                  child: const Text('Mark Meeting Held', style: TextStyle(fontSize: 13)),
                ),
              ),
            ]),
          ),
        ],

        const Divider(height: 28),
        Text('Stakeholders', style: AppTextStyles.titleMedium),
        const SizedBox(height: 8),
        if (stakeholders.isEmpty)
          Text('No stakeholders', style: AppTextStyles.bodyMedium)
        else
          Wrap(
            spacing: 8, runSpacing: 4,
            children: stakeholders.map((s) => Chip(
              label: Text('${s['role'] ?? ''}: ${s['user_id'] ?? ''}',
                  style: const TextStyle(fontSize: 12)),
              backgroundColor: AppColors.mist,
            )).toList(),
          ),

        const Divider(height: 28),
        Text('Entities', style: AppTextStyles.titleMedium),
        const SizedBox(height: 8),
        if (entities.isEmpty)
          Text('No entities assigned', style: AppTextStyles.bodyMedium)
        else
          Column(
            children: entities.map((e) => Container(
              margin: const EdgeInsets.only(bottom: 8),
              padding: const EdgeInsets.all(12),
              decoration: BoxDecoration(
                color: AppColors.mist, borderRadius: BorderRadius.circular(8),
                border: Border.all(color: AppColors.pebble),
              ),
              child: Row(children: [
                Expanded(
                  child: Text(
                    e['entity_name'] as String? ?? e['entity_id'] as String? ?? '',
                    style: AppTextStyles.bodyMedium,
                  ),
                ),
                Container(
                  padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 2),
                  decoration: BoxDecoration(
                    color: _statusBg(e['per_entity_status'] as String? ?? 'backlog'),
                    borderRadius: BorderRadius.circular(8),
                  ),
                  child: Text(
                    _statusLabel(e['per_entity_status'] as String? ?? 'backlog'),
                    style: TextStyle(
                      fontSize: 11,
                      color: _statusColor(e['per_entity_status'] as String? ?? 'backlog'),
                    ),
                  ),
                ),
              ]),
            )).toList(),
          ),

        const Divider(height: 28),
        Text('Subtasks', style: AppTextStyles.titleMedium),
        const SizedBox(height: 8),
        ...subtasks.map((s) => CheckboxListTile(
          value: s['status'] == 'done',
          onChanged: (_) {},
          title: Text(s['title'] as String? ?? '', style: AppTextStyles.bodyMedium),
          controlAffinity: ListTileControlAffinity.leading,
          contentPadding: EdgeInsets.zero,
        )),
        TextButton.icon(
          onPressed: () => ScaffoldMessenger.of(context)
              .showSnackBar(const SnackBar(content: Text('Add subtask — coming soon'))),
          icon: const Icon(Icons.add, size: 16),
          label: const Text('Add Subtask'),
        ),

        // Dependencies section
        const Divider(height: 28),
        Text('Dependencies', style: AppTextStyles.titleMedium),
        const SizedBox(height: 8),
        if (_dependencies == null)
          const Text('Loading…', style: TextStyle(color: AppColors.steel, fontSize: 13))
        else ...[
          if ((_dependencies!['depends_on'] as List? ?? []).isEmpty &&
              (_dependencies!['depended_on_by'] as List? ?? []).isEmpty)
            const Text('No dependencies', style: TextStyle(color: AppColors.steel, fontSize: 13))
          else ...[
            if ((_dependencies!['depends_on'] as List? ?? []).isNotEmpty) ...[
              const Text('Blocked by:', style: TextStyle(fontSize: 12, color: AppColors.steel)),
              const SizedBox(height: 4),
              ...(_dependencies!['depends_on'] as List).cast<Map<String, dynamic>>().map((t) => _DependencyRow(task: t, isBlocker: true)),
            ],
            if ((_dependencies!['depended_on_by'] as List? ?? []).isNotEmpty) ...[
              const SizedBox(height: 8),
              const Text('Blocking:', style: TextStyle(fontSize: 12, color: AppColors.steel)),
              const SizedBox(height: 4),
              ...(_dependencies!['depended_on_by'] as List).cast<Map<String, dynamic>>().map((t) => _DependencyRow(task: t, isBlocker: false)),
            ],
          ],
        ],

        const Divider(height: 28),
        Text('Attachments', style: AppTextStyles.titleMedium),
        const SizedBox(height: 8),
        ...attachments.map((a) => ListTile(
          contentPadding: EdgeInsets.zero,
          leading: const Icon(Icons.attach_file),
          title: Text(a['file_name'] as String? ?? a['file_url'] as String? ?? '',
              style: AppTextStyles.bodyMedium),
        )),
        TextButton.icon(
          onPressed: () => ScaffoldMessenger.of(context)
              .showSnackBar(const SnackBar(content: Text('File picker — coming soon'))),
          icon: const Icon(Icons.upload_file, size: 16),
          label: const Text('+ Add Attachment'),
        ),

        const Divider(height: 28),
        Text('Activity', style: AppTextStyles.titleMedium),
        const SizedBox(height: 8),
        ...comments.map((c) => Padding(
          padding: const EdgeInsets.only(bottom: 10),
          child: Row(crossAxisAlignment: CrossAxisAlignment.start, children: [
            const CircleAvatar(
              radius: 14, backgroundColor: AppColors.mist,
              child: Icon(Icons.person, size: 14, color: AppColors.steel),
            ),
            const SizedBox(width: 10),
            Expanded(child: Text(c['content'] as String? ?? '', style: AppTextStyles.bodyMedium)),
          ]),
        )),
        const SizedBox(height: 8),
        Row(children: [
          Expanded(
            child: TextField(
              controller: _commentController,
              decoration: InputDecoration(
                hintText: 'Add a comment...',
                filled: true,
                fillColor: AppColors.mist,
                border: OutlineInputBorder(
                  borderRadius: BorderRadius.circular(8),
                  borderSide: BorderSide.none,
                ),
              ),
            ),
          ),
          const SizedBox(width: 8),
          IconButton(
            icon: _savingComment
                ? const SizedBox(width: 18, height: 18, child: CircularProgressIndicator(strokeWidth: 2))
                : const Icon(Icons.send, color: AppColors.taskoraRed),
            onPressed: _savingComment ? null : _postComment,
          ),
        ]),
        // Activity log
        if (_activityLog.isNotEmpty) ...[
          const Divider(height: 28),
          Text('Activity Log', style: AppTextStyles.titleMedium),
          const SizedBox(height: 8),
          ..._activityLog.map((log) => Padding(
            padding: const EdgeInsets.only(bottom: 8),
            child: Row(crossAxisAlignment: CrossAxisAlignment.start, children: [
              Container(
                width: 8, height: 8, margin: const EdgeInsets.only(top: 5, right: 8),
                decoration: const BoxDecoration(color: AppColors.ocean, shape: BoxShape.circle),
              ),
              Expanded(child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                Text(
                  '${log['actor_email'] ?? 'System'} — ${(log['action'] as String? ?? '').replaceAll('_', ' ')}',
                  style: const TextStyle(fontSize: 12, color: AppColors.midnight),
                ),
                if (log['entity_label'] != null)
                  Text(log['entity_label'] as String, style: AppTextStyles.labelSmall),
              ])),
            ]),
          )),
        ],

        const SizedBox(height: 40),
      ],
    );
  }

  @override
  void dispose() {
    _titleController.dispose();
    _commentController.dispose();
    super.dispose();
  }
}

class _DependencyRow extends StatelessWidget {
  final Map<String, dynamic> task;
  final bool isBlocker;
  const _DependencyRow({required this.task, required this.isBlocker});

  Color _statusColor(String s) {
    switch (s) {
      case 'done': return const Color(0xFF059669);
      case 'blocked': return const Color(0xFFDC2626);
      case 'in_progress': return const Color(0xFF2563EB);
      default: return AppColors.steel;
    }
  }

  @override
  Widget build(BuildContext context) => Container(
    margin: const EdgeInsets.only(bottom: 4),
    padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 6),
    decoration: BoxDecoration(
      color: isBlocker ? const Color(0xFFFEF2F2) : const Color(0xFFF0FDF4),
      borderRadius: BorderRadius.circular(6),
      border: Border.all(color: isBlocker ? const Color(0xFFFECACA) : const Color(0xFFBBF7D0)),
    ),
    child: Row(children: [
      Icon(isBlocker ? Icons.lock_outline : Icons.arrow_forward, size: 14,
          color: isBlocker ? const Color(0xFFDC2626) : const Color(0xFF059669)),
      const SizedBox(width: 6),
      Expanded(child: Text(task['title'] as String? ?? '—', style: const TextStyle(fontSize: 12, color: AppColors.midnight))),
      Container(
        padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 2),
        decoration: BoxDecoration(color: AppColors.mist, borderRadius: BorderRadius.circular(4)),
        child: Text(
          (task['status'] as String? ?? '').replaceAll('_', ' '),
          style: TextStyle(fontSize: 10, color: _statusColor(task['status'] as String? ?? '')),
        ),
      ),
    ]),
  );
}
