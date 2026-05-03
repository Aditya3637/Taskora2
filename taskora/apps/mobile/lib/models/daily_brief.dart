class DailyBriefTask {
  final String id;
  final String title;
  final String priority;
  final String? dueDate;
  final String status;
  final List<Map<String, dynamic>> taskEntities;
  final String? blockerReason;
  final int? daysOverdue;
  final bool isStale;

  const DailyBriefTask({
    required this.id,
    required this.title,
    required this.priority,
    this.dueDate,
    required this.status,
    this.taskEntities = const [],
    this.blockerReason,
    this.daysOverdue,
    this.isStale = false,
  });

  factory DailyBriefTask.fromJson(Map<String, dynamic> json) => DailyBriefTask(
        id: json['id'] as String,
        title: json['title'] as String,
        priority: json['priority'] as String? ?? 'medium',
        dueDate: json['due_date'] as String?,
        status: json['status'] as String? ?? 'open',
        taskEntities:
            (json['task_entities'] as List<dynamic>?)?.cast<Map<String, dynamic>>() ?? [],
        blockerReason: json['blocker_reason'] as String?,
        daysOverdue: json['days_overdue'] as int?,
        isStale: json['is_stale'] as bool? ?? false,
      );
}

class InitiativeProgress {
  final String id;
  final String name;
  final double completionPct;
  final List<Map<String, dynamic>> entityBreakdown;

  const InitiativeProgress({
    required this.id,
    required this.name,
    required this.completionPct,
    this.entityBreakdown = const [],
  });

  factory InitiativeProgress.fromJson(Map<String, dynamic> json) => InitiativeProgress(
        id: json['id'] as String,
        name: (json['title'] ?? json['name']) as String,
        completionPct: (json['completion_pct'] as num?)?.toDouble() ?? 0.0,
        entityBreakdown:
            (json['entity_breakdown'] as List<dynamic>?)?.cast<Map<String, dynamic>>() ?? [],
      );
}

class QuickStats {
  final int openTasks;
  final double completionRateThisWeek;
  final int staleCount;

  const QuickStats({
    required this.openTasks,
    required this.completionRateThisWeek,
    required this.staleCount,
  });

  factory QuickStats.fromJson(Map<String, dynamic> json) => QuickStats(
        openTasks: json['open_tasks'] as int? ?? 0,
        completionRateThisWeek:
            (json['completion_rate_this_week'] as num?)?.toDouble() ?? 0.0,
        staleCount: json['stale_count'] as int? ?? 0,
      );
}

class DailyBriefGreeting {
  final String summaryLine;
  const DailyBriefGreeting({required this.summaryLine});
  factory DailyBriefGreeting.fromJson(Map<String, dynamic> json) =>
      DailyBriefGreeting(summaryLine: json['summary_line'] as String? ?? '');
}

class DailyBriefResponse {
  final String userId;
  final String generatedAt;
  final List<DailyBriefTask> decisionsPending;
  final List<DailyBriefTask> overdue;
  final List<DailyBriefTask> stale;
  final List<DailyBriefTask> dueThisWeek;
  final List<DailyBriefTask> blocked;
  final List<InitiativeProgress> initiativeProgress;
  final QuickStats? quickStats;
  final DailyBriefGreeting? greeting;

  const DailyBriefResponse({
    required this.userId,
    required this.generatedAt,
    this.decisionsPending = const [],
    this.overdue = const [],
    this.stale = const [],
    this.dueThisWeek = const [],
    this.blocked = const [],
    this.initiativeProgress = const [],
    this.quickStats,
    this.greeting,
  });

  factory DailyBriefResponse.fromJson(Map<String, dynamic> json) {
    List<DailyBriefTask> parseTasks(String key) =>
        (json[key] as List<dynamic>? ?? [])
            .map((e) => DailyBriefTask.fromJson(e as Map<String, dynamic>))
            .toList();

    return DailyBriefResponse(
      userId: json['user_id'] as String? ?? '',
      generatedAt: json['generated_at'] as String? ?? '',
      decisionsPending: parseTasks('pending_decisions'),
      overdue: parseTasks('overdue_tasks'),
      stale: parseTasks('stale_tasks'),
      dueThisWeek: parseTasks('due_this_week'),
      blocked: parseTasks('blocked_tasks'),
      initiativeProgress: (json['initiative_progress'] as List<dynamic>? ?? [])
          .map((e) => InitiativeProgress.fromJson(e as Map<String, dynamic>))
          .toList(),
      quickStats: json['quick_stats'] != null
          ? QuickStats.fromJson(json['quick_stats'] as Map<String, dynamic>)
          : null,
      greeting: json['greeting'] != null
          ? DailyBriefGreeting.fromJson(json['greeting'] as Map<String, dynamic>)
          : null,
    );
  }
}
