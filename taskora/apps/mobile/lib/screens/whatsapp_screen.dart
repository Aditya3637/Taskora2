import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import '../theme/app_colors.dart';
import '../theme/app_text_styles.dart';
import '../services/api_service.dart';

class WhatsAppScreen extends StatefulWidget {
  const WhatsAppScreen({super.key});
  @override
  State<WhatsAppScreen> createState() => _WhatsAppScreenState();
}

class _WhatsAppScreenState extends State<WhatsAppScreen> {
  final _api = ApiService();
  bool _loading = true;
  String? _error;
  String _businessId = '';
  List<Map<String, dynamic>> _messages = [];

  @override
  void initState() {
    super.initState();
    _init();
  }

  Future<void> _init() async {
    try {
      final businesses = await _api.getList('/api/v1/businesses/my');
      if (businesses.isNotEmpty) {
        _businessId = businesses[0]['id'] ?? '';
        await _generate();
      } else {
        setState(() { _loading = false; _error = 'No business found'; });
      }
    } catch (e) {
      setState(() { _loading = false; _error = e.toString(); });
    }
  }

  Future<void> _generate() async {
    setState(() { _loading = true; _error = null; });
    try {
      final result = await _api.post('/api/v1/whatsapp/digest', {'business_id': _businessId});
      setState(() {
        _messages = ((result['messages'] as List?) ?? []).cast<Map<String, dynamic>>();
        _loading = false;
      });
    } catch (e) {
      setState(() { _error = e.toString(); _loading = false; });
    }
  }

  Future<void> _copyMessage(String text) async {
    await Clipboard.setData(ClipboardData(text: text));
    if (mounted) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('Message copied to clipboard ✓')),
      );
    }
  }

  Future<void> _openWhatsApp(String waLink) async {
    // Use url_launcher if available, otherwise show the link
    ScaffoldMessenger.of(context).showSnackBar(
      SnackBar(
        content: Text('WhatsApp link: $waLink', maxLines: 2, overflow: TextOverflow.ellipsis),
        action: SnackBarAction(
          label: 'Copy Link',
          onPressed: () => Clipboard.setData(ClipboardData(text: waLink)),
        ),
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        title: const Text('WhatsApp Digest'),
        backgroundColor: const Color(0xFF25D366),
        foregroundColor: AppColors.white,
        actions: [
          IconButton(icon: const Icon(Icons.refresh), onPressed: _generate),
        ],
      ),
      body: _loading
          ? const Center(child: CircularProgressIndicator())
          : _error != null
              ? Center(child: Column(mainAxisSize: MainAxisSize.min, children: [
                  const Icon(Icons.error_outline, size: 48, color: AppColors.steel),
                  const SizedBox(height: 12),
                  Text(_error!, style: const TextStyle(color: AppColors.steel)),
                  const SizedBox(height: 16),
                  ElevatedButton(onPressed: _generate, child: const Text('Retry')),
                ]))
              : _messages.isEmpty
                  ? const Center(child: Text('No stakeholders found', style: TextStyle(color: AppColors.steel)))
                  : ListView.separated(
                      padding: const EdgeInsets.all(16),
                      itemCount: _messages.length,
                      separatorBuilder: (_, __) => const SizedBox(height: 16),
                      itemBuilder: (_, i) => _MessageCard(
                        msg: _messages[i],
                        onCopy: _copyMessage,
                        onWhatsApp: _openWhatsApp,
                      ),
                    ),
    );
  }
}

class _MessageCard extends StatefulWidget {
  final Map<String, dynamic> msg;
  final Future<void> Function(String) onCopy;
  final Future<void> Function(String) onWhatsApp;
  const _MessageCard({required this.msg, required this.onCopy, required this.onWhatsApp});
  @override
  State<_MessageCard> createState() => _MessageCardState();
}

class _MessageCardState extends State<_MessageCard> {
  bool _expanded = false;

  @override
  Widget build(BuildContext context) {
    final msg = widget.msg;
    final name = msg['user_name'] as String? ?? 'Unknown';
    final phone = msg['phone_number'] as String?;
    final text = msg['message'] as String? ?? '';
    final waLink = msg['wa_link'] as String? ?? '';

    return Container(
      decoration: BoxDecoration(
        color: AppColors.white,
        borderRadius: BorderRadius.circular(12),
        border: Border.all(color: AppColors.pebble),
        boxShadow: const [BoxShadow(color: Color(0x0A000000), blurRadius: 4, offset: Offset(0, 2))],
      ),
      child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
        // Header
        Padding(
          padding: const EdgeInsets.all(14),
          child: Row(children: [
            Container(
              width: 36, height: 36,
              decoration: const BoxDecoration(color: Color(0xFF25D366), shape: BoxShape.circle),
              child: const Icon(Icons.person, color: Colors.white, size: 20),
            ),
            const SizedBox(width: 10),
            Expanded(child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
              Text(name, style: AppTextStyles.titleMedium),
              if (phone != null) Text(phone, style: const TextStyle(fontSize: 11, color: AppColors.steel)),
            ])),
            IconButton(
              icon: Icon(_expanded ? Icons.expand_less : Icons.expand_more, color: AppColors.steel),
              onPressed: () => setState(() => _expanded = !_expanded),
            ),
          ]),
        ),

        // Message preview or full
        if (!_expanded)
          Padding(
            padding: const EdgeInsets.fromLTRB(14, 0, 14, 0),
            child: Text(
              text.split('\n').take(3).join('\n'),
              style: const TextStyle(fontSize: 12, color: AppColors.steel, fontFamily: 'monospace'),
              maxLines: 3,
              overflow: TextOverflow.ellipsis,
            ),
          ),
        if (_expanded)
          Container(
            margin: const EdgeInsets.fromLTRB(14, 0, 14, 0),
            padding: const EdgeInsets.all(12),
            decoration: BoxDecoration(color: const Color(0xFFECF9EC), borderRadius: BorderRadius.circular(8)),
            child: Text(text, style: const TextStyle(fontSize: 12, color: AppColors.midnight, fontFamily: 'monospace')),
          ),

        // Actions
        Padding(
          padding: const EdgeInsets.all(14),
          child: Row(children: [
            Expanded(
              child: OutlinedButton.icon(
                onPressed: () => widget.onCopy(text),
                icon: const Icon(Icons.copy, size: 16),
                label: const Text('Copy'),
                style: OutlinedButton.styleFrom(foregroundColor: AppColors.midnight),
              ),
            ),
            const SizedBox(width: 10),
            Expanded(
              child: ElevatedButton.icon(
                onPressed: () => widget.onWhatsApp(waLink),
                icon: const Icon(Icons.send, size: 16),
                label: const Text('WhatsApp'),
                style: ElevatedButton.styleFrom(
                  backgroundColor: const Color(0xFF25D366),
                  foregroundColor: Colors.white,
                ),
              ),
            ),
          ]),
        ),
      ]),
    );
  }
}
