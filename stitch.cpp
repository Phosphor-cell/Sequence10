#include "raylib.h"

int main() {
    InitWindow(800, 600, "My Game Engine");

    // Load your SVGs (Raylib handles basic textures/shapes)
    // Note: In real life, use a library like 'nanosvg' to load SVG files properly
    Texture2D torso = LoadTexture("placeholder_torso.svg");
    Texture2D weapon = LoadTexture("placeholder_weapon.svg");

    while (!WindowShouldClose()) {
        BeginDrawing();
        ClearBackground(RAYWHITE);

        // Stitching happens here: You render them at the same relative position
        DrawTexture(torso, 300, 200, WHITE);
        DrawTexture(weapon, 300 + 50, 200 + 30, WHITE); // Offset to "attach" to the hand

        EndDrawing();
    }
    CloseWindow();
    return 0;
}