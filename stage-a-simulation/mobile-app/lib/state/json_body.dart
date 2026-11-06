import 'dart:convert';

import 'package:http/http.dart' as http;

// response.body assumes latin-1 when a server sends no charset, which turns the product emoji
// into garbage. json is utf-8, so decode the bytes directly
Object? jsonBody(http.Response res) => jsonDecode(utf8.decode(res.bodyBytes));
