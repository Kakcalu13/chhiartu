cmake_minimum_required(VERSION 3.10)
project(kawr LANGUAGES CXX)

set(CMAKE_CXX_STANDARD 17)
set(CMAKE_CXX_STANDARD_REQUIRED ON)

add_executable(kawr src/main.cpp src/App.cpp src/Shape.cpp src/MeshExport.cpp)
target_include_directories(kawr PRIVATE src)

if(APPLE)
# macOS ships OpenGL + GLUT as system frameworks — nothing to install.
  target_compile_definitions(kawr PRIVATE GL_SILENCE_DEPRECATION)
  find_library(OPENGL_FRAMEWORK OpenGL REQUIRED)
  find_library(GLUT_FRAMEWORK GLUT REQUIRED)
  target_link_libraries(kawr PRIVATE ${OPENGL_FRAMEWORK} ${GLUT_FRAMEWORK})
else()
  find_package(OpenGL REQUIRED)
  find_package(GLUT REQUIRED)
  target_link_libraries(kawr PRIVATE ${OPENGL_LIBRARIES} ${GLUT_glut_LIBRARY})
endif()
