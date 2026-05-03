import 'dart:convert';
import 'package:http/http.dart' as http;
import 'package:supabase_flutter/supabase_flutter.dart';

const _baseUrl = String.fromEnvironment('API_BASE_URL', defaultValue: 'http://10.0.2.2:8000');

class ApiService {
  Future<String> get _token async =>
      Supabase.instance.client.auth.currentSession?.accessToken ?? '';

  Future<Map<String, String>> get _headers async {
    final token = await _token;
    return {'Content-Type': 'application/json', 'Authorization': 'Bearer $token'};
  }

  Future<Map<String, dynamic>> get(String path) async {
    final res = await http.get(Uri.parse('$_baseUrl$path'), headers: await _headers);
    if (res.statusCode >= 200 && res.statusCode < 300) {
      return jsonDecode(res.body) as Map<String, dynamic>;
    }
    throw ApiException(res.statusCode, res.body);
  }

  Future<List<dynamic>> getList(String path) async {
    final res = await http.get(Uri.parse('$_baseUrl$path'), headers: await _headers);
    if (res.statusCode >= 200 && res.statusCode < 300) {
      return jsonDecode(res.body) as List<dynamic>;
    }
    throw ApiException(res.statusCode, res.body);
  }

  Future<Map<String, dynamic>> post(String path, Map<String, dynamic> body) async {
    final res = await http.post(Uri.parse('$_baseUrl$path'), headers: await _headers, body: jsonEncode(body));
    if (res.statusCode >= 200 && res.statusCode < 300) {
      if (res.body.isEmpty) return {};
      return jsonDecode(res.body) as Map<String, dynamic>;
    }
    throw ApiException(res.statusCode, res.body);
  }

  Future<Map<String, dynamic>> patch(String path, Map<String, dynamic> body) async {
    final res = await http.patch(Uri.parse('$_baseUrl$path'), headers: await _headers, body: jsonEncode(body));
    if (res.statusCode >= 200 && res.statusCode < 300) {
      if (res.body.isEmpty) return {};
      return jsonDecode(res.body) as Map<String, dynamic>;
    }
    throw ApiException(res.statusCode, res.body);
  }

  Future<void> delete(String path) async {
    final res = await http.delete(Uri.parse('$_baseUrl$path'), headers: await _headers);
    if (res.statusCode < 200 || res.statusCode >= 300) {
      throw ApiException(res.statusCode, res.body);
    }
  }
}

class ApiException implements Exception {
  final int statusCode;
  final String body;
  const ApiException(this.statusCode, this.body);
  @override
  String toString() => 'ApiException($statusCode): $body';
}
