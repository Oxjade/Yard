# kotlinx.serialization keeps its generated serializers via the bundled consumer rules.
# Navigation type-safe routes are @Serializable classes; keep their names stable.
-keep class space.yardstore.app.app.Route** { *; }
-keep class space.yardstore.app.app.TabRoot { *; }
