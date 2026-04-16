class DailyBriefTask {
  final String id;
  final String title;
  final String priority;
  final String? dueDate;
  final String status;
  final List<Map<String, dynamic>> taskEntities;

  const DailyBriefTask({
    required this.id,
    required this.title,
    required this.priority,
    this.dueDate,
    required this.status,
    this.taskEntities = const [],
  });

  factory DailyBriefTask.fromJson(Map<String, dynamic> json) {
    return DailyBriefTask(
      id: json['id'] as String,
      title: json['title'] as String,
      priority: json['priority'] as String? ?? 'medium',
      dueDate: json['due_date'] as String?,
      status: json['status'] as String? ?? 'open',
      taskEntities: (json['task_entities'] as List<dynamic>?)
              ?.cast<Map<String, dynamic>>() ??
          [],
    );
  }
}

class DailyBriefResponse {
  final String userId;
  final String generatedAt;
  final List<DailyBriefTask> decisionsPending;
  final List<DailyBriefTask> overdue;
  final List<DailyBriefTask> stale;
  final List<DailyBriefTask> dueThisWeek;
  final List<DailyBriefTask> blocked;

  const DailyBriefResponse({
    required this.userId,
    required this.generatedAt,
    this.decisionsPending = const [],
    this.overdue = const [],
    this.stale = const [],
    this.dueThisWeek = const [],
    this.blocked = const [],
  });

  factory DailyBriefResponse.fromJson(Map<String, dynamic> json) {
    List<DailyBriefTask> _parse(String key) =>
        (json[key] as List<dynamic>? ?? [])
            .map((e) => DailyBriefTask.fromJson(e as Map<String, dynamic>))
            .toList();

    return DailyBriefResponse(
      userId: json['user_id'] as String,
      generatedAt: json['generated_at'] as String,
      decisionsPending: _parse('decisions_pending'),
      overdue: _parse('overdue'),
      stale: _parse('stale'),
      dueThisWeek: _parse('due_this_week'),
      blocked: _parse('blocked'),
    );
  }
}
